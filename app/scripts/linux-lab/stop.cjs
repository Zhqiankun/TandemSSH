const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net");
(async () => {
  const workspace = fs.realpathSync(path.resolve(__dirname, "../../..")),
    cache = fs.realpathSync(path.join(workspace, ".cache/linux-lab")),
    file = fs.realpathSync(
      process.argv[2] ||
        JSON.parse(fs.readFileSync(path.join(cache, "current.json"), "utf8"))
          .manifest,
    );
  if (
    !file
      .toLowerCase()
      .startsWith(path.join(cache, "runs").toLowerCase() + path.sep) ||
    path.basename(file) !== "connection.json"
  )
    throw Error("VM manifest escaped project cache");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    m.host !== "127.0.0.1" ||
    m.name !== "tandem-linux-" + m.id ||
    !Number.isInteger(m.qmpPort) ||
    m.qmpPort < 1 ||
    m.qmpPort > 65535
  )
    throw Error("VM identity invalid");
  const socket = net.createConnection({ host: "127.0.0.1", port: m.qmpPort });
  let text = "",
    seq = 0,
    closed = false;
  const waiting = new Map();
  const close = new Promise((resolve) =>
    socket.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  socket.on("data", (chunk) => {
    text += chunk;
    for (;;) {
      const at = text.indexOf("\n");
      if (at < 0) break;
      const line = text.slice(0, at);
      text = text.slice(at + 1);
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      const wait = waiting.get(item.id);
      if (!wait) continue;
      waiting.delete(item.id);
      clearTimeout(wait.timer);
      item.error
        ? wait.reject(Error(item.error.desc))
        : wait.resolve(item.return);
    }
  });
  const request = (execute) =>
    new Promise((resolve, reject) => {
      const id = ++seq,
        timer = setTimeout(() => {
          waiting.delete(id);
          reject(Error("QMP timeout"));
        }, 5000);
      waiting.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify({ execute, id }) + "\n");
    });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    await request("qmp_capabilities");
    const identity = await request("query-name");
    if (identity.name !== m.name)
      throw Error("Refusing to stop a different QEMU instance");
    await request("system_powerdown");
    let timer;
    await Promise.race([
      close,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 15000);
      }),
    ]);
    clearTimeout(timer);
    let forced = false;
    if (!closed) {
      if ((await request("query-name")).name !== m.name)
        throw Error("VM identity changed");
      forced = true;
      await request("quit").catch((error) => {
        if (!closed) throw error;
      });
    }
    console.log(JSON.stringify({ shutdownRequested: true, id: m.id, forced }));
  } finally {
    socket.destroy();
    for (const item of waiting.values()) {
      clearTimeout(item.timer);
      item.reject(Error("QMP closed"));
    }
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
