const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");

// This drives only the app launched by this script on a disposable CI runner.
async function main() {
  if (
    process.platform !== "win32" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  )
    throw Error(
      "Installed desktop verification requires a GitHub-hosted Windows runner",
    );
  const root = fs.realpathSync(process.argv[2]);
  const profile = path.resolve(process.argv[3]);
  const reportRoot = fs.realpathSync(process.argv[4]);
  const runnerRoot = fs.realpathSync(process.env.RUNNER_TEMP);
  if (
    !root.toLowerCase().startsWith(runnerRoot.toLowerCase() + path.sep) ||
    path.basename(root) !== "TandemSSH"
  )
    throw Error(
      "Desktop installation is outside the disposable runner directory",
    );
  if (
    profile.toLowerCase() !==
      path.join(process.env.APPDATA, "TandemSSH").toLowerCase() ||
    fs.existsSync(profile)
  )
    throw Error(
      "Expected a fresh application profile on the disposable runner",
    );
  const executable = path.join(root, "TandemSSH.exe");
  const expectedUrl = pathToFileURL(
    path.join(root, "resources/app.asar/dist/index.html"),
  ).href;
  const expectedVersion = require("../package.json").version;
  const { RELEASE_URL } = require("../electron/update-service.cjs");
  async function freePort(port = 0) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const chosen = server.address().port;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    return chosen;
  }
  for (let port = 30001; port <= 30012; port++) await freePort(port);
  const rendererPort = await freePort();
  let mainPort = await freePort();
  while (mainPort === rendererPort) mainPort = await freePort();
  fs.mkdirSync(profile);
  const environment = { ...process.env, TANDEMSSH_DATA_DIR: profile };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${rendererPort}`,
      `--inspect=127.0.0.1:${mainPort}`,
    ],
    {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "",
    spawnError,
    exited = false;
  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
      exited = true;
      resolve();
    });
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-128 * 1024);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  async function until(fn, timeout = 90000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exited)
        throw Error("Installed application exited before verification");
      try {
        const value = await fn();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw Error(
      "Desktop observation timed out" +
        (lastError ? ": " + lastError.message : ""),
    );
  }
  async function connect(port, choose) {
    const target = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw Error("Debugger discovery failed");
      return (await response.json()).find(choose);
    });
    const address = new URL(target.webSocketDebuggerUrl);
    if (
      !["127.0.0.1", "localhost"].includes(address.hostname) ||
      Number(address.port) !== port
    )
      throw Error("Unexpected debugger address");
    const ws = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(Error("Debugger connection timed out"));
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(Error("Debugger connection failed"));
      };
    });
    let sequence = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data),
        item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error
        ? item.reject(Error(message.error.message))
        : item.resolve(message.result);
    };
    ws.onclose = () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(Error("Debugger closed"));
      }
      pending.clear();
    };
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Debugger call timed out: " + method));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    return {
      call,
      async evaluate(expression) {
        const result = await call("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw Error(
            result.exceptionDetails.exception?.description ??
              result.exceptionDetails.text,
          );
        return result.result.value;
      },
      close: () => ws.close(),
    };
  }
  let mainClient,
    renderer,
    identityVerified = false,
    succeeded = false;
  try {
    mainClient = await connect(mainPort, (target) => target.type === "node");
    const electron =
      "process.getBuiltinModule('module').createRequire(process.cwd()+'/verification.cjs')('electron')";
    const identity = await mainClient.evaluate(
      `(()=>{const e=${electron};return {pid:process.pid,executable:process.execPath,profile:e.app.getPath('userData'),version:e.app.getVersion()};})()`,
    );
    if (
      identity.pid !== child.pid ||
      identity.executable.toLowerCase() !== executable.toLowerCase() ||
      identity.profile.toLowerCase() !== profile.toLowerCase() ||
      identity.version !== expectedVersion
    )
      throw Error(
        "Installed desktop process, data directory or version mismatch",
      );
    identityVerified = true;
    renderer = await connect(
      rendererPort,
      (target) =>
        target.type === "page" && target.url.split(/[?#]/)[0] === expectedUrl,
    );
    await until(async () => {
      const response = await fetch("http://127.0.0.1:30001/health", {
        signal: AbortSignal.timeout(1500),
      });
      return response.ok && (await response.json()).status === "ok";
    });
    const state = await until(async () => {
      const value = await renderer.evaluate(
        `(async()=>({title:document.title,lang:document.documentElement.lang,text:document.body.innerText,updates:await window.electronAPI?.updates.action('status')}))()`,
      );
      return value.lang === "zh-CN" &&
        value.text.includes("检查更新") &&
        value.text.includes("运行正常")
        ? value
        : undefined;
    });
    if (
      !state.updates?.ok ||
      !state.updates.value.installed ||
      state.updates.value.currentVersion !== expectedVersion ||
      state.updates.value.releaseUrl !== RELEASE_URL
    )
      throw Error(
        "Installed desktop does not expose its actual installed update state",
      );
    await renderer.call("Page.enable");
    const screenshot = await renderer.call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(reportRoot, "installed-desktop.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    await renderer.evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('检查更新'));if(!button)throw Error('Chinese update button missing');button.click();})()`,
    );
    const dialog = await until(
      () =>
        renderer.evaluate(
          `(()=>{const dialog=document.querySelector('[role="dialog"]');return dialog?.innerText.includes(${JSON.stringify(expectedVersion)}) ? dialog.innerText : null;})()`,
        ),
      15000,
    );
    const updateShot = await renderer.call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(reportRoot, "installed-updates.png"),
      Buffer.from(updateShot.data, "base64"),
    );
    fs.writeFileSync(
      path.join(reportRoot, "desktop.json"),
      JSON.stringify(
        {
          version: identity.version,
          language: state.lang,
          title: state.title,
          databaseReady: true,
          installed: state.updates.value.installed,
          updateSource: state.updates.value.releaseUrl,
          updateDialog: dialog,
        },
        null,
        2,
      ),
    );
    await mainClient.evaluate(
      `setTimeout(()=>{const e=${electron};e.BrowserWindow.getAllWindows().forEach(w=>w.destroy());e.app.quit();},100);true`,
    );
    renderer.close();
    renderer = undefined;
    mainClient.close();
    mainClient = undefined;
    const result = await Promise.race([
      exitPromise,
      delay(30000).then(() => {
        throw Error("Installed app did not exit normally");
      }),
    ]);
    if (result?.code !== 0) throw Error("Installed app exited unsuccessfully");
    // Database/background processes must release their real listening ports after app.quit().
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        for (let port = 30001; port <= 30012; port++) await freePort(port);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await delay(250);
      }
    }
    succeeded = true;
    console.log(
      JSON.stringify({
        installedDesktop: true,
        language: state.lang,
        version: expectedVersion,
        cleanExit: true,
      }),
    );
  } finally {
    renderer?.close();
    mainClient?.close();
    if (!exited && child.pid) {
      // Kill only the still-tracked child tree on failure; never classify forced cleanup as success.
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 15000,
      });
    }
    fs.writeFileSync(path.join(reportRoot, "desktop-process.log"), output);
    if (!succeeded)
      fs.writeFileSync(
        path.join(reportRoot, "desktop-failure.json"),
        JSON.stringify({ identityVerified, exited, pid: child.pid ?? null }),
      );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
