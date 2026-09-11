const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { until, freePort, connect } = require("./upgrade-debugger.cjs");
const { FEED_URL, REPOSITORY } = require("../electron/update-service.cjs");
const labels = require("../src/ui/locales/translated/zh_CN.json");
async function hash(file, algorithm = "sha256", encoding = "hex") {
  const digest = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
}
async function run(command, args, log, options = {}) {
  const output = fs.createWriteStream(log);
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(
          Error("Upgrade subprocess timed out: " + path.basename(command)),
        );
      }, options.timeout ?? 600000);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(
              Error(
                "Upgrade subprocess failed (" +
                  code +
                  "): " +
                  path.basename(log),
              ),
            );
      });
    });
  } finally {
    output.end();
  }
}
async function main() {
  if (
    process.platform !== "win32" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    process.env.RUNNER_OS !== "Windows"
  )
    throw Error(
      "Online upgrade verification requires a GitHub-hosted Windows runner",
    );
  const root = fs.realpathSync(process.argv[2]),
    profile = fs.realpathSync(process.argv[3]),
    report = fs.realpathSync(process.argv[4]);
  const runner = fs.realpathSync(process.env.RUNNER_TEMP),
    owned = path.dirname(root),
    appRoot = path.resolve(__dirname, "..");
  if (
    !root.toLowerCase().startsWith(runner.toLowerCase() + path.sep) ||
    path.basename(root) !== "TandemSSH" ||
    !path.basename(owned).startsWith("tandem-install-")
  )
    throw Error("Upgrade installation escaped owned runner directory");
  if (
    profile.toLowerCase() !==
    path.join(process.env.APPDATA, "TandemSSH").toLowerCase()
  )
    throw Error("Upgrade profile mismatch");
  const executable = path.join(root, "TandemSSH.exe");
  const oldVersion = require("../package.json").version,
    parts = oldVersion.split("-")[0].split(".").map(Number);
  if (
    parts.length !== 3 ||
    parts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isSafeInteger(parts[2] + 1)
  )
    throw Error("Invalid upgrade fixture version");
  const newVersion = require("semver").inc(
    oldVersion,
    oldVersion.includes("-alpha.") ? "prerelease" : "patch",
    "alpha",
  );
  if (!newVersion) throw Error("Invalid upgrade fixture version");
  const ports = {
    oldMain: await freePort(),
    oldRenderer: await freePort(),
    newMain: await freePort(),
    newRenderer: await freePort(),
  };
  if (new Set(Object.values(ports)).size !== 4)
    throw Error("Duplicate upgrade debugger ports");
  const fixtureRoot = path.join(owned, "update-fixture"),
    source = path.join(owned, "update-observer");
  fs.mkdirSync(source);
  fs.mkdirSync(fixtureRoot);
  // Only the unpublished fixture has this observational entrypoint. Product main.cjs is unchanged.
  fs.writeFileSync(
    path.join(source, "upgrade-observer.cjs"),
    `if(process.execPath.toLowerCase()!==${JSON.stringify(executable.toLowerCase())})throw Error('Unexpected upgrade fixture executable');\n` +
      `process.env.TANDEMSSH_DATA_DIR=${JSON.stringify(profile)};\n` +
      `require('node:inspector').open(${ports.newMain},'127.0.0.1');\n` +
      `require('electron').app.commandLine.appendSwitch('remote-debugging-port','${ports.newRenderer}');\n` +
      `require('./main.cjs');\n`,
  );
  const config = JSON.parse(
    fs.readFileSync(path.join(appRoot, "electron-builder.json"), "utf8"),
  );
  config.directories.output = fixtureRoot;
  config.npmRebuild = false;
  config.extraMetadata = {
    ...config.extraMetadata,
    version: newVersion,
    main: "electron/upgrade-observer.cjs",
  };
  config.files.push({
    from: source,
    to: "electron",
    filter: ["upgrade-observer.cjs"],
  });
  const backendMetadataRoot = path.join(source, "backend-metadata");
  fs.mkdirSync(backendMetadataRoot);
  const backendMetadata = JSON.parse(
    fs.readFileSync(path.join(appRoot, "dist/backend/package.json"), "utf8"),
  );
  if (
    backendMetadata.name !== "tandemssh-backend" ||
    backendMetadata.version !== oldVersion
  )
    throw Error("Upgrade fixture backend version mismatch");
  fs.writeFileSync(
    path.join(backendMetadataRoot, "package.json"),
    JSON.stringify({ ...backendMetadata, version: newVersion }, null, 2) + "\n",
  );
  config.files.push("!dist/backend/package.json");
  config.files.push({
    from: backendMetadataRoot,
    to: "dist/backend",
    filter: ["package.json"],
  });
  // Mirror fixture metadata into the physical backend directory used by stdio.
  config.extraResources.push({
    from: backendMetadataRoot,
    to: "app.asar.unpacked/dist/backend",
    filter: ["package.json"],
  });
  const configFile = path.join(owned, "update-fixture-builder.json");
  fs.writeFileSync(configFile, JSON.stringify(config));
  await run(
    process.execPath,
    [
      path.join(appRoot, "node_modules/electron-builder/cli.js"),
      "--config",
      configFile,
      "--win",
      "nsis",
      "--publish=never",
    ],
    path.join(report, "upgrade-build.log"),
    { cwd: appRoot },
  );
  const installer = path.join(fixtureRoot, `TandemSSH-${newVersion}-x64.exe`),
    size = fs.statSync(installer).size;
  const digest = await hash(installer),
    sha512 = await hash(installer, "sha512", "base64");
  const artifact = `/${REPOSITORY}/releases/download/v${newVersion}/TandemSSH-${newVersion}-x64.exe`;
  const manifest = {
    version: newVersion,
    files: [{ url: "https://github.com" + artifact, size, sha512 }],
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    requests.push(pathname);
    if (pathname === `/${REPOSITORY}/releases.atom`) {
      res.writeHead(200, { "Content-Type": "application/atom+xml" });
      res.end(
        `<feed><entry><link href="https://github.com/${REPOSITORY}/releases/tag/v${newVersion}"/></entry></feed>`,
      );
      return;
    }
    if (
      pathname === new URL(FEED_URL).pathname + "latest.yml" ||
      pathname === `/${REPOSITORY}/releases/download/v${newVersion}/latest.yml`
    ) {
      res.writeHead(200, { "Content-Type": "application/yaml" });
      res.end(JSON.stringify(manifest));
      return;
    }
    const file =
      pathname === artifact
        ? installer
        : pathname === artifact + ".blockmap"
          ? installer + ".blockmap"
          : null;
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Length": fs.statSync(file).size,
      "Content-Type": "application/octet-stream",
    });
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpPort = server.address().port;
  const env = {
    ...process.env,
    TANDEMSSH_DATA_DIR: profile,
    LOCALAPPDATA: path.join(owned, "update-cache"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(env.LOCALAPPDATA);
  const child = spawn(
    executable,
    [
      `--inspect=127.0.0.1:${ports.oldMain}`,
      `--remote-debugging-port=${ports.oldRenderer}`,
    ],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    oldExited = false,
    oldExit;
  child.stdout.on("data", (b) => {
    output = (output + b.toString()).slice(-128 * 1024);
  });
  child.stderr.on("data", (b) => {
    output = (output + b.toString()).slice(-128 * 1024);
  });
  child.on("error", (e) => {
    output += "\n" + e.message;
    oldExited = true;
  });
  child.on("exit", (code) => {
    oldExited = true;
    oldExit = code;
  });
  const load = `process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root, "resources/app.asar/electron/verification.cjs"))})`;
  const electron = load + "('electron')";
  let mainClient,
    renderer,
    newMain,
    newRenderer,
    newPid,
    stage = "old-identity",
    succeeded = false;
  const evidence = {
    oldVersion,
    newVersion,
    fixtureSameSource: true,
    realInstaller: true,
    localHttpOnly: true,
    check: false,
    download: false,
    cancelPreserved: false,
    nativeConfirmed: false,
    newStarted: false,
    dataPreserved: false,
    cleanExit: false,
  };
  const identityExpression = `(()=>{const e=${electron};if(!e.app.isReady())return null;return {pid:process.pid,executable:process.execPath,profile:e.app.getPath('userData'),version:e.app.getVersion()};})()`;
  const verifyIdentity = (value, version, pid) => {
    if (
      !value ||
      value.executable.toLowerCase() !== executable.toLowerCase() ||
      value.profile.toLowerCase() !== profile.toLowerCase() ||
      value.version !== version ||
      (pid && value.pid !== pid)
    )
      throw Error("Upgrade desktop identity mismatch");
  };
  const api = (driver, route, method = "GET", body) =>
    driver.evaluate(
      `(async()=>{const r=await fetch('http://127.0.0.1:30001'+${JSON.stringify(route)},{method:${JSON.stringify(method)},headers:{Authorization:'Bearer '+localStorage.getItem('jwt'),'Content-Type':'application/json','X-Electron-App':'true'},body:${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))}});const value=await r.json();if(!r.ok)throw Error('Upgrade API '+r.status);return value;})()`,
      true,
    );
  const readyDesktop = async (driver) => {
    await until(() =>
      driver.evaluate(
        "document.documentElement.lang==='zh-CN'&&document.body.innerText.includes('快速连接')",
      ),
    );
    await until(async () => {
      const skipped = await driver.evaluate(
        "(()=>{const d=[...document.querySelectorAll('[role=dialog]')].find(e=>e.innerText.replace(/\\s+/g,'').includes('欢迎使用同舟SSH'));if(!d)return false;const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='跳过设置');if(!b||b.disabled)return false;const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!r.width||!r.height||!hit||!b.contains(hit))return false;b.click();return true;})()",
      );
      if (skipped) return true;
      const preferences = await api(driver, "/ui-preferences");
      return preferences.preferences?.onboarding?.completedVersion > 0;
    }, 30000);
    await until(() =>
      driver.evaluate(
        "![...document.querySelectorAll('[role=dialog]')].some(e=>e.innerText.replace(/\\s+/g,'').includes('欢迎使用同舟SSH'))",
      ),
    );
  };
  const click = (label) =>
    until(
      () =>
        renderer.evaluate(
          `(()=>{const b=[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!r.width||!r.height||!hit||!b.contains(hit))return false;b.click();return true;})()`,
        ),
      30000,
    );
  const ui = async (action, target, sha) =>
    run(
      "pwsh.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-File",
        path.join(__dirname, "confirm-upgrade-window.ps1"),
        "-Executable",
        target,
        "-Sha256",
        sha,
        "-Action",
        action,
        "-Report",
        path.join(report, "upgrade-ui-" + action + ".json"),
      ],
      path.join(report, "upgrade-ui-" + action + ".log"),
      { cwd: root, timeout: 200000 },
    );
  const status = (driver) =>
    driver.evaluate("window.electronAPI.updates.action('status')", true);
  const shot = async (driver, name) => {
    await driver.call("Page.enable");
    const s = await driver.call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(report, name + ".png"),
      Buffer.from(s.data, "base64"),
    );
  };
  try {
    mainClient = await connect(ports.oldMain, (t) => t.type === "node");
    verifyIdentity(
      await until(() => mainClient.evaluate(identityExpression)),
      oldVersion,
      child.pid,
    );
    // Redirect only this owned process's updater network session. The metadata still uses its fixed GitHub URL.
    await mainClient.evaluate(
      `(()=>{const e=${electron};e.session.fromPartition('electron-updater',{cache:false}).webRequest.onBeforeRequest({urls:['https://github.com/${REPOSITORY}/releases/*','https://github.com/${REPOSITORY}/releases.atom']},(details,done)=>{const u=new URL(details.url);done({redirectURL:'http://127.0.0.1:${httpPort}'+u.pathname+u.search});});return true;})()`,
    );
    const expectedUrl = pathToFileURL(
      path.join(root, "resources/app.asar/dist/index.html"),
    ).href;
    renderer = await connect(
      ports.oldRenderer,
      (t) => t.type === "page" && t.url.split(/[?#]/)[0] === expectedUrl,
    );
    await readyDesktop(renderer);
    stage = "retention-seed";
    const markerName = "升级数据保留-" + randomUUID();
    const workflow = await api(renderer, "/tandem/workflows", "POST", {
      allowedHostIds: [],
      definition: {
        schemaVersion: 1,
        id: "upgrade-retention",
        name: markerName,
        version: "1.0.0",
        parameters: {},
        defaults: { cwd: "/tmp" },
        steps: [
          {
            id: "probe",
            name: "仅保存不执行",
            action: { type: "command", program: "pwd", args: [] },
          },
        ],
      },
    });
    fs.writeFileSync(
      path.join(profile, "upgrade-retention.json"),
      JSON.stringify({ markerName, workflowId: workflow.id }),
    );
    const retainedDigest = await hash(
      path.join(profile, "upgrade-retention.json"),
    );
    await renderer.evaluate(
      `localStorage.setItem('tandem-upgrade-retention',${JSON.stringify(markerName)});window.dispatchEvent(new Event('tandem-open-updates'));true`,
    );
    stage = "check";
    await click(labels.tandem.updates.check);
    await until(async () => {
      const r = await status(renderer);
      if (r.value?.error) throw Error(r.value.error);
      return (
        r.ok &&
        r.value.status === "available" &&
        r.value.latestVersion === newVersion &&
        r.value.installed
      );
    });
    if (requests.includes(artifact))
      throw Error("Installer downloaded without request");
    evidence.check = true;
    await shot(renderer, "upgrade-available");
    stage = "download";
    await click(labels.tandem.updates.download);
    await until(async () => {
      const r = await status(renderer);
      if (r.value?.error) throw Error(r.value.error);
      return r.ok && r.value.status === "downloaded";
    }, 180000);
    const downloaded = await mainClient.evaluate(
      `${load}('electron-updater').autoUpdater.installerPath`,
    );
    const resolved = fs.realpathSync(downloaded);
    if (
      !resolved.toLowerCase().startsWith(owned.toLowerCase() + path.sep) ||
      (await hash(resolved)) !== digest
    )
      throw Error("Downloaded installer ownership or digest mismatch");
    evidence.download = true;
    await shot(renderer, "upgrade-downloaded");
    const oldDigest = await hash(executable);
    stage = "cancel-confirmation";
    await click(labels.tandem.updates.install);
    await ui("cancel", executable, oldDigest);
    await until(async () => {
      const r = await status(renderer);
      return r.ok && r.value.status === "downloaded";
    });
    if (oldExited || (await hash(executable)) !== oldDigest)
      throw Error(
        "Cancelled installation changed or closed the old application",
      );
    evidence.cancelPreserved = true;
    stage = "confirm-installation";
    await click(labels.tandem.updates.install);
    await ui("approve", executable, oldDigest);
    evidence.nativeConfirmed = true;
    // Node waits for attached inspectors before exit. Release our observers before the installer waits for the app.
    renderer.close();
    renderer = undefined;
    mainClient.close();
    mainClient = undefined;
    await until(() => oldExited, 30000);
    evidence.oldExitCode = oldExit;
    if (oldExit !== 0)
      throw Error(
        "Old application did not exit normally for upgrade: " + oldExit,
      );
    // Complete the real assisted NSIS wizard; the default Run option launches the instrumented new fixture.
    stage = "installer";
    await ui("installer", resolved, digest);
    stage = "new-identity";
    newMain = await connect(ports.newMain, (t) => t.type === "node");
    const identity = await until(() => newMain.evaluate(identityExpression));
    verifyIdentity(identity, newVersion);
    newPid = identity.pid;
    if (newPid === child.pid)
      throw Error("Upgrade did not create a new process");
    evidence.newStarted = true;
    if (
      (await hash(executable)) !==
      (await hash(path.join(fixtureRoot, "win-unpacked/TandemSSH.exe")))
    )
      throw Error("Installed executable differs from the newer fixture");
    newRenderer = await connect(
      ports.newRenderer,
      (t) => t.type === "page" && t.url.split(/[?#]/)[0] === expectedUrl,
    );
    await readyDesktop(newRenderer);
    stage = "retention-check";
    const retained = await api(newRenderer, "/tandem/workflows");
    const retention = {
      workflow:
        retained.workflows?.some(
          (w) => w.id === workflow.id && w.definition?.name === markerName,
        ) === true,
      file:
        (await hash(path.join(profile, "upgrade-retention.json"))) ===
        retainedDigest,
      ui:
        (await newRenderer.evaluate(
          "localStorage.getItem('tandem-upgrade-retention')",
        )) === markerName,
    };
    evidence.retention = retention;
    if (!retention.workflow || !retention.file || !retention.ui)
      throw Error("Upgrade did not retain database, file or UI data");
    const newState = await status(newRenderer);
    if (
      !newState.ok ||
      newState.value.currentVersion !== newVersion ||
      !newState.value.installed
    )
      throw Error("New version does not expose its installed update state");
    if (
      fs.statSync(path.join(profile, "server-data/db.sqlite.encrypted")).size <
      128
    )
      throw Error("Encrypted database missing after update");
    evidence.dataPreserved = true;
    await newRenderer.evaluate(
      "window.dispatchEvent(new Event('tandem-open-updates'));true",
    );
    await shot(newRenderer, "upgrade-new-version");
    stage = "normal-exit";
    await newMain.evaluate(
      `setTimeout(()=>{const e=${electron};e.BrowserWindow.getAllWindows().forEach(w=>w.destroy());e.app.quit();},100);true`,
    );
    newRenderer.close();
    newRenderer = undefined;
    newMain.close();
    newMain = undefined;
    await until(async () => {
      try {
        const r = await fetch("http://127.0.0.1:30001/health", {
          signal: AbortSignal.timeout(500),
        });
        return !r.ok;
      } catch {
        return true;
      }
    }, 30000);
    await until(() => {
      try {
        process.kill(newPid, 0);
        return false;
      } catch {
        return true;
      }
    }, 30000);
    evidence.cleanExit = true;
    succeeded = true;
    console.log(
      JSON.stringify({
        onlineUpgrade: true,
        oldVersion,
        newVersion,
        retainedWorkflow: true,
        autoStarted: true,
      }),
    );
  } catch (error) {
    evidence.failure = error.message;
    evidence.stage = stage;
    if (renderer || newRenderer)
      await shot(newRenderer ?? renderer, "upgrade-failure").catch(() => {});
    throw error;
  } finally {
    renderer?.close();
    mainClient?.close();
    newRenderer?.close();
    newMain?.close();
    if (!oldExited && child.pid)
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 15000,
      });
    // The surrounding installer verifier owns final cleanup of any remaining installed processes.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(path.join(report, "upgrade-process.log"), output);
    fs.writeFileSync(
      path.join(report, "upgrade-requests.json"),
      JSON.stringify(requests),
    );
    fs.writeFileSync(
      path.join(report, "upgrade.json"),
      JSON.stringify({ ...evidence, succeeded, fixtureRoot }, null, 2),
    );
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
