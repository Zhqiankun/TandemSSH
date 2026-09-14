import { expect, it } from "vitest";
import { once } from "node:events";
import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";
import { C2S_MAX_MESSAGE_BYTES as backendLimit } from "../src/backend/hosts/tunnel/c2s-relay-utils.js";
const { C2S_MAX_MESSAGE_BYTES: clientLimit, c2sWebSocketOptions } = createRequire(import.meta.url)("../electron/c2s-websocket-options.cjs");
it("keeps both process limits aligned and prevents caller options from lifting the limit", () => {
  expect(clientLimit).toBe(1024 * 1024); expect(backendLimit).toBe(clientLimit);
  expect(c2sWebSocketOptions({ maxPayload: 0, perMessageDeflate: true, headers: { "X-Fixture": "yes" } })).toEqual({ maxPayload: clientLimit, perMessageDeflate: false, headers: { "X-Fixture": "yes" } });
});
it.each(["client", "server"] as const)("%s accepts the boundary and refuses oversized fragmented messages", async side => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: backendLimit, perMessageDeflate: false });
  await once(server, "listening"); const accepted = once(server, "connection");
  const client = new WebSocket("ws://127.0.0.1:" + (server.address() as { port: number }).port, c2sWebSocketOptions());
  client.on("error", () => {});
  const [peer] = await accepted as [WebSocket]; peer.on("error", () => {});
  if(client.readyState !== WebSocket.OPEN) await once(client, "open");
  const sender = side === "client" ? peer : client, receiver = side === "client" ? client : peer;
  let messages = 0; receiver.on("message", () => { messages++; });
  try {
    const normal = once(receiver, "message"); sender.send(Buffer.alloc(clientLimit, 0x41));
    const [data] = await normal; expect((data as Buffer).length).toBe(clientLimit);
    const rejected = once(receiver, "error"), closed = once(sender, "close");
    sender.send(Buffer.alloc(clientLimit / 2), { fin: false });
    sender.send(Buffer.alloc(clientLimit / 2 + 1), { fin: true });
    const [error] = await rejected; expect((error as Error).message).toMatch(/payload/i);
    const [code] = await closed; expect(code).toBe(1009);
    expect(messages).toBe(1);
  } finally { client.terminate(); peer.terminate(); await new Promise<void>(r => server.close(() => r())); }
}, 10000);
