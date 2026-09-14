import { expect, it } from "vitest";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { admitC2SRelay, C2S_RELAY_CONNECTION_LIMIT, C2S_TRANSPORT_CONNECTION_LIMIT } from "../../hosts/tunnel/c2s-admission.js";
it("refuses an excess relay without disturbing existing peers and admits after release", async () => {
  expect(C2S_RELAY_CONNECTION_LIMIT).toBe(128);
  expect(C2S_TRANSPORT_CONNECTION_LIMIT).toBe(256);
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let admitted = 0;
  server.on("connection", ws => {
    ws.on("error", () => {});
    if(!admitC2SRelay(server, ws, 2))return;
    admitted++; ws.on("message", data => ws.send(data));
  });
  const clients: WebSocket[] = [];
  const connect = () => { const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as { port: number }).port);ws.on("error", () => {});clients.push(ws);return ws; };
  try {
    const a = connect(); await once(a, "open");
    const b = connect(); await once(b, "open");
    const refused = connect(), error = once(refused, "message"), closed = once(refused, "close");
    expect(JSON.parse(String((await error)[0]))).toEqual({ type: "error", error: "C2S_CONNECTION_LIMIT" });
    expect((await closed)[0]).toBe(1013); expect(admitted).toBe(2);
    const echo = once(a, "message");a.send("existing-live");expect(String((await echo)[0])).toBe("existing-live");
    const released = once(a, "close");a.close();await released;
    const next = connect();await once(next, "open");expect(admitted).toBe(3);
    const nextEcho = once(next, "message");next.send("replacement");expect(String((await nextEcho)[0])).toBe("replacement");
  } finally { for(const ws of clients)ws.terminate();for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r())); }
}, 10000);
