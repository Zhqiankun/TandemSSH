import { expect, it, vi } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";
const { createC2SDownloadPump } = createRequire(import.meta.url)("../electron/c2s-download-pump.cjs");
it.each([false, true])("real WebSocket download handles delayed TCP writes, cancelled=%s", async cancel => {
  const tcp = createServer(); tcp.listen(0, "127.0.0.1"); await once(tcp, "listening");
  const accepted = once(tcp, "connection");
  const destination = connect((tcp.address() as { port: number }).port, "127.0.0.1");
  destination.on("error", () => {});
  const [output] = await accepted as [Socket]; output.on("error", () => {}); output.cork();
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(wss, "listening");
  const incoming = once(wss, "connection");
  const relay = new WebSocket("ws://127.0.0.1:" + (wss.address() as { port: number }).port);
  relay.on("error", () => {});
  const [sender] = await incoming as [WebSocket];
  if(relay.readyState !== WebSocket.OPEN) await once(relay, "open");
  const pause = vi.spyOn(relay, "pause"), resume = vi.spyOn(relay, "resume"), errors: Error[] = [];
  const pump = createC2SDownloadPump(output, relay, (e: Error) => errors.push(e));
  relay.on("message", bytes => pump.write(Buffer.from(bytes as Buffer)));
  const payload = Buffer.alloc(1024 * 1024 + 9, 0xc7), hash = createHash("sha256");
  let received = 0;
  destination.on("data", chunk => { received += chunk.length; hash.update(chunk); });
  try {
    sender.send(payload);
    await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    expect(received).toBe(0);
    expect(output.writableLength).toBe(payload.length);
    expect(resume).not.toHaveBeenCalled();
    if(cancel) pump.close();
    output.uncork();
    await vi.waitFor(() => expect(received).toBe(payload.length), { timeout: 3000 });
    expect(hash.digest("hex")).toBe(createHash("sha256").update(payload).digest("hex"));
    expect(resume).toHaveBeenCalledTimes(cancel ? 0 : 1);
    expect(errors).toEqual([]);
    pump.close(); expect(output.listenerCount("drain")).toBe(0);
  } finally {
    pump.close(); output.destroy(); destination.destroy(); relay.terminate(); sender.terminate();
    await Promise.all([new Promise<void>(r => tcp.close(() => r())), new Promise<void>(r => wss.close(() => r()))]);
  }
}, 10000);
