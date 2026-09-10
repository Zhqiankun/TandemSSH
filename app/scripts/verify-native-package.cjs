const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const PREFIX = "TANDEM_NATIVE_PACKAGE_PROBE ";
async function probe(root) {
  if (
    process.execPath.toLowerCase() !==
    path.join(root, "TandemSSH.exe").toLowerCase()
  )
    throw Error("Probe must run in the packaged executable");
  const notices =
    require("./verify-distribution-notices.cjs").verifyDistributionNotices(
      root,
    );
  if (notices.length !== 4) throw Error("Distribution notices incomplete");
  const load = createRequire(
    path.join(
      root,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      "probe.cjs",
    ),
  );
  const modulesRoot = fs.realpathSync(
    path.join(root, "resources", "app.asar.unpacked", "node_modules"),
  );
  if (!modulesRoot.startsWith(fs.realpathSync(root) + path.sep))
    throw Error("Package modules escaped the package directory");
  const verified = new Set();
  function verifyDependency(name, from, optional = false) {
    let entry;
    try {
      entry = from.resolve(name);
    } catch (error) {
      if (optional && error.code === "MODULE_NOT_FOUND") return;
      throw error;
    }
    const resolved = fs.realpathSync(entry);
    if (!resolved.startsWith(modulesRoot + path.sep))
      throw Error("Dependency is missing from package: " + name);
    let directory = path.dirname(resolved),
      metadata;
    while (directory.startsWith(modulesRoot + path.sep)) {
      const file = path.join(directory, "package.json");
      if (fs.existsSync(file)) {
        const candidate = JSON.parse(fs.readFileSync(file, "utf8"));
        if (candidate.name === name) {
          metadata = candidate;
          break;
        }
      }
      directory = path.dirname(directory);
    }
    if (!metadata) throw Error("Packaged dependency metadata missing: " + name);
    if (verified.has(directory)) return;
    verified.add(directory);
    const child = createRequire(path.join(directory, "package.json"));
    for (const dependency of Object.keys(metadata.dependencies ?? {}))
      verifyDependency(
        dependency,
        child,
        !!metadata.optionalDependencies?.[dependency],
      );
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {}))
      verifyDependency(dependency, child, true);
  }
  for (const name of [
    "better-sqlite3",
    "@serialport/bindings-cpp",
    "@napi-rs/keyring",
    "node-pty",
  ])
    verifyDependency(name, load);
  const filesRoot = fs.realpathSync(
    path.join(root, "resources", "app.asar.unpacked", "electron"),
  );
  if (!filesRoot.startsWith(fs.realpathSync(root) + path.sep))
    throw Error("Native file capabilities escaped package");
  for (const name of [
    "task-local-files.cjs",
    "task-local-directories.cjs",
    "task-upload-access.cjs",
    "upload-sources.cjs",
    "upload-source-checkpoint.cjs",
    "download-sink.cjs",
    "download-checkpoint.cjs",
    "download-directory-targets.cjs",
    "download-directory-checkpoint.cjs",
    "download-batch-record.cjs",
    "download-batch-vault.cjs",
  ]) {
    const file = fs.realpathSync(path.join(filesRoot, name));
    if (!file.startsWith(filesRoot + path.sep) || !fs.statSync(file).isFile())
      throw Error("Native file capability missing: " + name);
  }
  const { UploadSourceStore } = load(
    path.join(filesRoot, "upload-sources.cjs"),
  );
  const { DownloadDirectoryTargets } = load(
    path.join(filesRoot, "download-directory-targets.cjs"),
  );
  for (const [type, methods] of [
    [UploadSourceStore, ["checkpoint", "restore"]],
    [DownloadDirectoryTargets, ["checkpoint", "restore", "attachRestored"]],
  ])
    for (const method of methods)
      if (typeof type.prototype[method] !== "function")
        throw Error(
          "Packaged directory recovery capability missing: " + method,
        );
  const { DownloadBatchVault } = load(
    path.join(filesRoot, "download-batch-vault.cjs"),
  );
  if (
    typeof DownloadBatchVault.prototype.claim !== "function" ||
    typeof DownloadBatchVault.prototype.change !== "function"
  )
    throw Error("Packaged download batch vault missing");
  const { TaskLocalFiles } = load(path.join(filesRoot, "task-local-files.cjs"));
  const taskFiles = new TaskLocalFiles();
  if (
    typeof taskFiles.directory !== "function" ||
    typeof taskFiles.directoryState !== "function"
  )
    throw Error("Packaged directory capability missing");
  await taskFiles.dispose();
  const Database = load("better-sqlite3"),
    database = new Database(":memory:");
  try {
    if (database.prepare("SELECT 7 AS value").get().value !== 7)
      throw Error("Packaged SQLite failed");
  } finally {
    database.close();
  }
  const serial = load("@serialport/bindings-cpp");
  if (!serial.autoDetect()) throw Error("Packaged serial binding missing");
  const keyring = load("@napi-rs/keyring");
  if (typeof keyring.AsyncEntry !== "function")
    throw Error("Packaged keyring binding missing");
  const pty = load("node-pty");
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn(
      "cmd.exe",
      ["/d", "/c", "echo TANDEM_PACKAGED_PTY_OK"],
      {
        name: "xterm-256color",
        cols: 100,
        rows: 24,
        cwd: root,
        useConptyDll: true,
        env: { ...process.env },
      },
    );
    let output = "",
      finished = false,
      data,
      exit;
    const done = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      data?.dispose();
      exit?.dispose();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      terminal.kill();
      done(Error("Packaged terminal timed out"));
    }, 15000);
    data = terminal.onData((text) => {
      output = (output + text).slice(-65536);
    });
    exit = terminal.onExit((event) =>
      done(
        event.exitCode === 0 && output.includes("TANDEM_PACKAGED_PTY_OK")
          ? undefined
          : Error("Packaged terminal did not return the expected output"),
      ),
    );
  });
  console.log(
    PREFIX +
      JSON.stringify({
        dependenciesVerified: verified.size,
        fileCapabilities: true,
        directoryCapabilities: true,
        directoryRecovery: true,
        sqlite: true,
        serial: true,
        keyring: true,
        pty: true,
        modules: process.versions.modules,
        electron: process.versions.electron ?? null,
      }),
  );
}
if (process.argv[2] === "--probe") {
  probe(path.resolve(process.argv[3]))
    .then(() => {
      // Native worker references can outlive their completed test operation.
      // All test resources are closed before exiting this dedicated probe process.
      process.stdout.write("", () => process.exit(0));
    })
    .catch((error) =>
      process.stderr.write(error.message + "\n", () => process.exit(1)),
    );
} else {
  const { FEED_URL } = require("../electron/update-service.cjs");
  const yaml = require("js-yaml");
  try {
    if (process.platform !== "win32")
      throw Error("Windows package verification requires Windows");
    const root = path.resolve(
      process.argv[2] ?? path.join(__dirname, "..", "release", "win-unpacked"),
    );
    const executable = path.join(root, "TandemSSH.exe");
    for (const file of [
      executable,
      path.join(root, "resources", "app.asar"),
      path.join(root, "resources", "app-update.yml"),
    ])
      if (!fs.statSync(file).isFile())
        throw Error("Packaged file missing: " + path.basename(file));
    const updateConfig = yaml.load(
      fs.readFileSync(path.join(root, "resources", "app-update.yml"), "utf8"),
    );
    if (
      !updateConfig ||
      updateConfig.provider !== "generic" ||
      updateConfig.url !== FEED_URL
    )
      throw Error("Package has the wrong update channel");
    const result = spawnSync(executable, [__filename, "--probe", root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      encoding: "utf8",
      timeout: 25000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw Error(
        (result.stderr || result.stdout).trim() ||
          "Native package probe failed",
      );
    const line = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith(PREFIX));
    if (!line) throw Error("Native package probe did not report completion");
    const evidence = JSON.parse(line.slice(PREFIX.length));
    if (
      ![
        "sqlite",
        "serial",
        "keyring",
        "pty",
        "fileCapabilities",
        "directoryCapabilities",
      ].every((key) => evidence[key] === true)
    )
      throw Error("Native package probe incomplete");
    if (
      !Number.isInteger(evidence.dependenciesVerified) ||
      evidence.dependenciesVerified < 4
    )
      throw Error("Packaged dependency check incomplete");
    console.log(JSON.stringify({ ...evidence, updateChannel: FEED_URL }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
