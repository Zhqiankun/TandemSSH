const fs = require("node:fs"),
  path = require("node:path"),
  { spawn, spawnSync } = require("node:child_process");
const workspace = path.resolve(__dirname, "..");
const cache = path.join(workspace, ".cache");
fs.mkdirSync(cache, { recursive: true });
const executable = process.env.TANDEM_TEST_CODEX;
if (!executable || !process.argv[2])
  throw Error("Explicit test executable and configuration are required");
let cfg;
try {
  const text = fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, "");
  if (Buffer.byteLength(text) > 64000) throw Error();
  cfg = JSON.parse(text);
} catch {
  throw Error("Invalid MCP verification configuration JSON");
}
const inside = path.resolve(workspace, "app") + path.sep;
if (
  typeof cfg.command !== "string" ||
  !path.isAbsolute(cfg.command) ||
  !fs.existsSync(cfg.command) ||
  !["node", "node.exe", "tandemssh", "tandemssh.exe"].includes(
    path.basename(cfg.command).toLowerCase(),
  ) ||
  !Array.isArray(cfg.args) ||
  cfg.args.length !== 5 ||
  cfg.args.some((value) => typeof value !== "string" || value.includes("\0")) ||
  cfg.args[1] !== "--profile" ||
  cfg.args[3] !== "--client" ||
  !path.resolve(cfg.args[0]).startsWith(inside) ||
  !cfg.args[0]
    .replaceAll("\\", "/")
    .endsWith("/dist/backend/backend/mcp/stdio.js") ||
  ![cfg.args[2], cfg.args[4]].every((value) => /^[a-f0-9-]{36}$/i.test(value))
)
  throw Error("Expected a local TandemSSH stdio entry and pairing identifiers");
const name =
  "tandemssh_verify_" +
  require("node:crypto").randomUUID().replaceAll("-", "").slice(0, 12);
const override =
  "mcp_servers={" +
  name +
  "={command=" +
  JSON.stringify(cfg.command) +
  ",args=" +
  JSON.stringify(cfg.args) +
  ',env={ELECTRON_RUN_AS_NODE="1"},startup_timeout_sec=15,tool_timeout_sec=45}}';
const disabled =
  "{command=" +
  JSON.stringify(process.execPath) +
  ',args=["-e","process.exit(0)"],enabled=false}';
const isolated = [
  "-c",
  override.slice(0, -1) +
    ",codexstyle=" +
    disabled +
    ",cua_repl=" +
    disabled +
    ",node_repl=" +
    disabled +
    "}",
];
const list = spawnSync(executable, [...isolated, "mcp", "list", "--json"], {
  cwd: workspace,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30000,
});
if (list.status !== 0)
  throw Error(
    "Codex configuration validation failed; no unrelated servers were initialized",
  );
const inventory = JSON.parse(list.stdout).filter((item) => item.enabled);
if (inventory.length !== 1 || inventory[0].name !== name)
  throw Error("Refusing to initialize unrelated MCP servers");
const transport = inventory[0].transport;
if (
  transport?.type !== "stdio" ||
  transport.command !== cfg.command ||
  JSON.stringify(transport.args) !== JSON.stringify(cfg.args)
)
  throw Error("Codex resolved a different MCP transport");
const proc = spawn(
  executable,
  [...isolated, "-c", "plugins={}", "app-server", "--listen", "stdio://"],
  { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
let buffer = "",
  nextId = 0;
const pending = new Map();
let stderr = "";
proc.stderr.on("data", (data) => {
  stderr = (stderr + data.toString()).slice(-10000);
});
proc.stdout.on("data", (data) => {
  buffer += data.toString();
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      message.error
        ? waiter.reject(
            Error("Codex RPC failed (" + String(message.error.code) + ")"),
          )
        : waiter.resolve(message.result);
    }
  }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("Timed out: " + method));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
(async () => {
  await rpc("initialize", {
    clientInfo: { name: "tandemssh-mcp-verification", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  proc.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const status = await rpc("mcpServerStatus/list", {
    detail: "toolsAndAuthOnly",
    limit: 20,
  });
  const row = status.data.find((item) => item.name === name);
  const tools = Object.values(row?.tools ?? {}).map((tool) => ({
    name: tool.name,
    title: tool.title,
  }));
  const expectedVersion = JSON.parse(
    fs.readFileSync(path.join(workspace, "app/package.json"), "utf8"),
  ).version;
  if (row?.serverInfo?.version !== expectedVersion)
    throw Error(
      "Codex MCP server version does not match the application build",
    );
  const result = {
    configurationValidated: true,
    serverName: row?.name,
    serverInfo: row?.serverInfo,
    runtimeStatus: row?.runtimeStatus,
    toolCount: tools.length,
    tools,
  };
  fs.writeFileSync(
    path.join(cache, "codex-mcp-integration.json"),
    JSON.stringify(result, null, 2),
  );
  if (
    tools.length !== 38 ||
    ![
      "list_authorized_files",
      "upload_file",
      "download_file",
      "get_transfer_status",
      "release_transfer",
      "list_directory",
      "stat_file",
      "run_workflow",
      "read_file",
      "get_file_content",
      "propose_file_edit",
      "propose_file_write",
      "preview_directory_transfer",
      "get_directory_transfer",
      "run_directory_transfer",
      "get_directory_run",
      "release_directory_transfer",
    ].every((name) => tools.some((tool) => tool.name === name))
  )
    throw Error("Codex did not discover all workflow and file tools");
  if (
    ![
      "list_saved_tasks",
      "get_saved_task",
      "save_task_progress",
      "restore_task_progress",
    ].every((name) => tools.some((tool) => tool.name === name))
  )
    throw Error("Codex did not discover task recovery tools");
  console.log(JSON.stringify(result));
})()
  .catch((error) => {
    fs.writeFileSync(
      path.join(cache, "codex-mcp-probe-error.log"),
      error.message,
    );
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
    }
    pending.clear();
    proc.stdin.end();
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill();
    }, 3000).unref();
  });
