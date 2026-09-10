import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
const require = createRequire(import.meta.url),
  { probeC2SRelay } = require("../electron/c2s-relay-probe.cjs");
const servers: WebSocketServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string") throw Error("TCP fixture");
  return {
    server,
    url: `ws://127.0.0.1:${address.port}`,
    signal: new AbortController(),
  };
}
it("closes a real waiting relay immediately when its request is cancelled", async () => {
  const f = await fixture(),
    connected = once(f.server, "connection");
  const result = probeC2SRelay({
    url: f.url,
    options: {},
    tunnel: { name: "test" },
    signal: f.signal.signal,
  });
  const [peer] = (await connected) as [WebSocket];
  await once(peer, "message");
  const closed = once(peer, "close");
  f.signal.abort(Error("C2S_CANCELLED"));
  expect(await result).toEqual({ success: false, error: "C2S_CANCELLED" });
  await closed;
  expect(f.server.clients.size).toBe(0);
});
it("does not open a socket for a previously cancelled request", async () => {
  const f = await fixture();
  let connections = 0;
  f.server.on("connection", () => connections++);
  f.signal.abort(Error("C2S_SESSION_CHANGED"));
  expect(
    await probeC2SRelay({
      url: f.url,
      options: {},
      tunnel: {},
      signal: f.signal.signal,
    }),
  ).toEqual({ success: false, error: "C2S_SESSION_CHANGED" });
  expect(connections).toBe(0);
});
it("completes once on readiness and closes the real relay", async () => {
  const f = await fixture();
  let closed!: Promise<unknown>;
  f.server.on("connection", (peer) => {
    closed = once(peer, "close");
    peer.on("message", (raw) => {
      expect(JSON.parse(raw.toString()).type).toBe("test");
      peer.send(JSON.stringify({ type: "ready" }));
    });
  });
  expect(
    await probeC2SRelay({
      url: f.url,
      options: {},
      tunnel: {},
      signal: f.signal.signal,
    }),
  ).toEqual({ success: true });
  f.signal.abort(Error("late"));
  await closed;
});
it("terminates a stalled real relay at the deadline", async () => {
  const f = await fixture();
  let closed!: Promise<unknown>;
  f.server.on("connection", (peer) => {
    closed = once(peer, "close");
  });
  expect(
    await probeC2SRelay({
      url: f.url,
      options: {},
      tunnel: {},
      signal: f.signal.signal,
      timeoutMs: 1000,
    }),
  ).toEqual({ success: false, error: "Tunnel test timed out" });
  expect(closed).toBeDefined();
  await closed;
  expect(f.server.clients.size).toBe(0);
});
