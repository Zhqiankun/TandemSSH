import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { ChatDelivery } from "../../ai/chat-delivery.js";
afterEach(() => vi.useRealTimers());
function fixture() {
  const response = Object.assign(new EventEmitter(), {
    writableLength: 0,
    write: vi.fn(() => false),
    destroy: vi.fn(),
  });
  const abort = new AbortController();
  return {
    response,
    abort,
    delivery: new ChatDelivery(response as unknown as ServerResponse, abort),
  };
}
it("waits for drain before continuing and removes the listener", async () => {
  const f = fixture();
  let finished = false;
  const pending = f.delivery.send({ type: "token", text: "中文" }).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(f.response.write).toHaveBeenCalledOnce();
  f.response.emit("drain");
  await pending;
  expect(finished).toBe(true);
  expect(f.response.listenerCount("drain")).toBe(0);
});
it("cancels a queued delivery when the client disconnects", async () => {
  const f = fixture();
  const pending = f.delivery.send({ type: "token", text: "pending" });
  const rejected = expect(pending).rejects.toThrow("MODEL_STREAM_INTERRUPTED");
  f.abort.abort();
  await rejected;
  expect(f.response.listenerCount("drain")).toBe(0);
  await expect(
    f.delivery.send({ type: "token", text: "no" }),
  ).rejects.toBeDefined();
  expect(f.response.write).toHaveBeenCalledOnce();
});
it("times out backpressure and closes the response", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const pending = f.delivery.send({ type: "token", text: "pending" });
  const rejected = expect(pending).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(f.response.destroy).toHaveBeenCalledOnce();
  expect(f.abort.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects oversized frames or pending queues before write", async () => {
  for (const existing of [false, true]) {
    const f = fixture();
    if (existing) f.response.writableLength = 256 * 1024 + 1;
    await expect(
      f.delivery.send({ text: existing ? "small" : "x".repeat(256 * 1024) }),
    ).rejects.toThrow("MODEL_RESPONSE_TOO_LARGE");
    expect(f.response.write).not.toHaveBeenCalled();
    expect(f.response.destroy).toHaveBeenCalledOnce();
  }
});
it("caps cumulative delivery even when every write drains", async () => {
  const f = fixture();
  f.response.write.mockReturnValue(true);
  let accepted = 0;
  try {
    for (let i = 0; i < 100; i++) {
      await f.delivery.send({ text: "x".repeat(64 * 1024) });
      accepted++;
    }
  } catch (error) {
    expect((error as Error).message).toBe("MODEL_RESPONSE_TOO_LARGE");
  }
  expect(accepted).toBe(63);
  expect(f.abort.signal.aborted).toBe(true);
});
