import { afterEach, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import { sendC2SBinary, writeC2SStreamChunk } from "../../hosts/tunnel/c2s-relay-utils.js";
afterEach(() => vi.useRealTimers());
it("pauses a binary source until websocket buffering drains", async () => {
  vi.useFakeTimers();
  const source = new PassThrough(), send = vi.fn();
  const ws = { readyState: 1, bufferedAmount: 1024 * 1024 + 1, send };
  const payload = Buffer.from("中文\0data");
  sendC2SBinary(ws as unknown as WebSocket, payload, source);
  expect(send.mock.calls[0][0]).toBe(payload);
  expect(source.isPaused()).toBe(true);
  await vi.advanceTimersByTimeAsync(25);
  expect(source.isPaused()).toBe(true);
  ws.bufferedAmount = 0;
  await vi.advanceTimersByTimeAsync(25);
  expect(source.isPaused()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  source.destroy();
});
it("does not restart a destroyed source after buffered websocket output", async () => {
  vi.useFakeTimers();
  const source = new PassThrough(), resume = vi.spyOn(source, "resume");
  const ws = { readyState: 1, bufferedAmount: 2 * 1024 * 1024, send: vi.fn() };
  sendC2SBinary(ws as unknown as WebSocket, Buffer.from("data"), source);
  source.destroy(); ws.bufferedAmount = 0;
  await vi.advanceTimersByTimeAsync(25);
  expect(resume).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it("closes an overloaded SSH target without adding more bytes", () => {
  const target = new PassThrough(), write = vi.spyOn(target, "write"), close = vi.fn();
  Object.defineProperty(target, "writableLength", { value: 8 * 1024 * 1024 + 1 });
  writeC2SStreamChunk(target as unknown as ClientChannel, Buffer.from("extra"), {} as WebSocket, close);
  expect(close).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled(); target.destroy();
});
