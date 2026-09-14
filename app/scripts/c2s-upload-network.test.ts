import { expect, it } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";
const { createC2SUploadPump } = createRequire(import.meta.url)("../electron/c2s-upload-pump.cjs");

it.each([false, true])("real TCP upload waits for ready and handles cancellation=%s", async cancel => {
  const tcp = createServer();
  tcp.listen(0, "127.0.0.1");
  await once(tcp, "listening");
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const tcpAccepted = once(tcp, "connection");
  const writer = connect((tcp.address() as { port: number }).port, "127.0.0.1");
  writer.on("error", () => {});
  const [input] = await tcpAccepted as [Socket];
  input.on("error", () => {});
  const wsAccepted = once(wss, "connection");
  const ws = new WebSocket("ws://127.0.0.1:" + (wss.address() as { port: number }).port);
  ws.on("error", () => {});
  const [receiver] = await wsAccepted as [WebSocket];
  if (ws.readyState !== WebSocket.OPEN) await once(ws, "open");
  const hash = createHash("sha256");
  let bytes = 0;
  const payload = Buffer.alloc(1024 * 1024 + 7, 0xa7), prefix = Buffer.from("中文前缀\0");
  let complete!: () => void;
  const finished = new Promise<void>(resolve => { complete = resolve; });
  receiver.on("message", data => { const chunk = Buffer.from(data as Buffer); bytes += chunk.length; hash.update(chunk); if(bytes === payload.length + prefix.length)complete(); });
  const failures: Error[] = [];
  const pump = createC2SUploadPump(input, ws, (error: Error) => failures.push(error));
  try {
    writer.write(payload);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(bytes).toBe(0);
    expect(input.readableFlowing).toBe(false);
    expect(input.readableLength).toBeLessThanOrEqual(input.readableHighWaterMark + 65536);
    if (cancel) {
      pump.close();
      pump.start(prefix);
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(bytes).toBe(0);
      expect(input.readableFlowing).toBe(false);
    } else {
      pump.start(prefix);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("network upload timeout")), 3000); })]);
      } finally { if (timer) clearTimeout(timer); }
      expect(bytes).toBe(payload.length + prefix.length);
      expect(hash.digest("hex")).toBe(createHash("sha256").update(prefix).update(payload).digest("hex"));
    }
    expect(failures).toEqual([]);
  } finally {
    pump.close(); writer.destroy(); input.destroy(); ws.terminate(); receiver.terminate();
    await Promise.all([new Promise<void>(resolve => tcp.close(() => resolve())), new Promise<void>(resolve => wss.close(() => resolve()))]);
  }
}, 10000);
