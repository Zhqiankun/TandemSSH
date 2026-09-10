import { afterEach, expect, it, vi } from "vitest";
import { readChatEvents } from "@/features/ai/chat-stream-reader";
afterEach(() => vi.useRealTimers());
async function collect(
  response: Response,
  signal = new AbortController().signal,
) {
  const events = [];
  for await (const e of readChatEvents(response, signal)) events.push(e);
  return events;
}
it("preserves split UTF-8 events and releases the reader", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"token","text":"中文"}\n\n',
  );
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  expect(await collect(new Response(body))).toEqual([
    { type: "token", text: "中文" },
  ]);
  expect(body.locked).toBe(false);
});
it("bounds an unterminated line and cancels the source", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(256 * 1024 + 1).fill(120));
    },
    cancel,
  });
  await expect(collect(new Response(body))).rejects.toThrow(
    "MODEL_RESPONSE_TOO_LARGE",
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
it("bounds many small frames even when total bytes are small", async () => {
  await expect(collect(new Response("\n".repeat(65537)))).rejects.toThrow(
    "MODEL_RESPONSE_TOO_LARGE",
  );
});
it("preserves an HTTP JSON error and rejects malformed events", async () => {
  await expect(
    collect(
      new Response(JSON.stringify({ error: "MODEL_CONTEXT_LIMIT" }), {
        status: 400,
      }),
    ),
  ).rejects.toThrow("MODEL_CONTEXT_LIMIT");
  await expect(collect(new Response("data: broken\n\n"))).rejects.toThrow(
    "MODEL_STREAM_INVALID",
  );
});
it("times out a silent reader and clears both timers", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const promise = collect(new Response(new ReadableStream({ cancel })));
  const rejected = expect(promise).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
  await vi.advanceTimersByTimeAsync(60000);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
