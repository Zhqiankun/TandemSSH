import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { TerminalOutputDelivery } from "../../../hosts/terminal/output-delivery.js";
const sockets: Array<ReturnType<typeof fake>> = [];
function fake() {
  const ws = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    bufferedAmount: 0,
    send: vi.fn((_data: string, callback?: (error?: Error) => void) =>
      callback?.(),
    ),
    close: vi.fn(),
    terminate: vi.fn(),
  });
  ws.close.mockImplementation(() => {
    ws.readyState = WebSocket.CLOSING;
  });
  ws.terminate.mockImplementation(() => {
    ws.readyState = WebSocket.CLOSED;
    ws.emit("close");
  });
  return ws;
}
function socket() {
  const s = fake();
  sockets.push(s);
  return s as unknown as WebSocket;
}
afterEach(() => {
  for (const s of sockets.splice(0)) s.emit("close");
  vi.useRealTimers();
});
it("releases only the acknowledged socket's cumulative delivery credit", () => {
  const d = new TerminalOutputDelivery(180, 8),
    a = socket(),
    b = socket(),
    gap = vi.fn();
  d.configure(a, true);
  d.configure(b, true);
  expect(d.send(a, { type: "data", data: "界".repeat(20) }, gap)).toBe(true);
  expect(d.acknowledge(b, 1)).toBe(false);
  expect(d.acknowledge(a, 999)).toBe(false);
  expect(d.acknowledge(a, 1)).toBe(true);
  expect(d.acknowledge(a, 1)).toBe(true);
  expect(d.send(a, { type: "data", data: "界".repeat(20) }, gap)).toBe(true);
  expect(
    JSON.parse(vi.mocked(a.send).mock.calls[1][0] as string).deliveryId,
  ).toBe(2);
  expect(gap).not.toHaveBeenCalled();
});
it("does not release bytes for invalid or future acknowledgements", () => {
  const d = new TerminalOutputDelivery(180, 8),
    ws = socket(),
    gap = vi.fn();
  d.configure(ws, true);
  d.send(ws, { type: "data", data: "界".repeat(20) }, gap);
  for (const id of [0, -1, 2, 1.2, "1", null, NaN])
    expect(d.acknowledge(ws, id)).toBe(false);
  expect(d.send(ws, { type: "data", data: "界".repeat(20) }, gap)).toBe(false);
  expect(gap).toHaveBeenCalledOnce();
  expect(ws.close).toHaveBeenCalledWith(1013, "TERMINAL_OUTPUT_OVERFLOW");
});
it("bounds tiny unacknowledged frames independently of their byte count", () => {
  const d = new TerminalOutputDelivery(4096, 2),
    ws = socket(),
    gap = vi.fn();
  d.configure(ws, true);
  expect(d.send(ws, { type: "data", data: "a" }, gap)).toBe(true);
  expect(d.send(ws, { type: "data", data: "b" }, gap)).toBe(true);
  expect(d.send(ws, { type: "data", data: "c" }, gap)).toBe(false);
  expect(d.send(ws, { type: "data", data: "d" }, gap)).toBe(false);
  expect(gap).toHaveBeenCalledOnce();
});
it("bounds legacy network buffers and force-closes only the affected socket", () => {
  vi.useFakeTimers();
  const d = new TerminalOutputDelivery(100),
    ws = socket(),
    healthy = socket();
  Object.defineProperty(ws, "bufferedAmount", { value: 100 });
  const gap = vi.fn(() => {
    expect(d.send(ws, { type: "context.gap" }, vi.fn())).toBe(false);
  });
  expect(d.send(ws, { type: "data", data: "x" }, gap)).toBe(false);
  expect(d.send(healthy, { type: "data", data: "ok" }, vi.fn())).toBe(true);
  vi.advanceTimersByTime(999);
  expect(ws.terminate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(ws.terminate).toHaveBeenCalledOnce();
  expect(healthy.terminate).not.toHaveBeenCalled();
});
it("revokes delivery once when the transport reports an asynchronous send failure", () => {
  const d = new TerminalOutputDelivery(),
    ws = socket(),
    gap = vi.fn();
  vi.mocked(ws.send).mockImplementation((_data, cb) => {
    (cb as (error: Error) => void)(Error("fixture write failed"));
  });
  d.send(ws, { type: "data", data: "x" }, gap);
  d.send(ws, { type: "data", data: "next" }, gap);
  expect(gap).toHaveBeenCalledOnce();
  expect(ws.close).toHaveBeenCalledOnce();
});
it("closes a real WebSocket reader that consumes transport bytes but never acknowledges rendering", async () => {
  const d = new TerminalOutputDelivery(4096, 2),
    gap = vi.fn();
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  server.on("connection", (ws) => {
    ws.on("error", () => {});
    d.configure(ws, true);
    for (let i = 0; i < 100; i++)
      d.send(ws, { type: "data", data: "x".repeat(100) }, gap);
  });
  const client = new WebSocket(
    "ws://127.0.0.1:" + (server.address() as { port: number }).port,
  );
  client.on("error", () => {});
  const messages: unknown[] = [];
  client.on("message", (data) => messages.push(JSON.parse(data.toString())));
  try {
    const closed = await new Promise<{ code: number; reason: string }>(
      (resolve) =>
        client.once("close", (code, reason) =>
          resolve({ code, reason: reason.toString() }),
        ),
    );
    expect(closed).toEqual({ code: 1013, reason: "TERMINAL_OUTPUT_OVERFLOW" });
    expect(messages).toHaveLength(2);
    expect(gap).toHaveBeenCalledOnce();
  } finally {
    client.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
