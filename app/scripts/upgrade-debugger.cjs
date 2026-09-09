const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
async function until(read, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await delay(250);
  }
  throw Error(
    "Upgrade observation timed out" + (last ? ": " + last.message : ""),
  );
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function connect(port, choose) {
  const target = await until(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok ? (await r.json()).find(choose) : null;
  });
  const url = new URL(target.webSocketDebuggerUrl);
  if (
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    Number(url.port) !== port
  )
    throw Error("Foreign upgrade debugger");
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(Error("Upgrade debugger connection timeout"));
    }, 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(Error("Upgrade debugger connection failed"));
    };
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data),
      p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
  };
  ws.onclose = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Upgrade debugger closed"));
    }
    pending.clear();
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Upgrade debugger timeout: " + method));
        }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    call,
    close: () => ws.close(),
    async evaluate(expression, awaitPromise = false) {
      const r = await call("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw Error(
          r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
        );
      return r.result.value;
    },
  };
}
module.exports = { until, freePort, connect };
