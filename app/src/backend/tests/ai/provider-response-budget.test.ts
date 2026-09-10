import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { fetchBoundedResponse } from "../../ai/providers/response-budget.js";
import { readSseLines, assertOk } from "../../ai/providers/http.js";
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
}));
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const limits = { maxBytes: 32, idleMs: 1000, totalMs: 3000 };
async function fixture(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
describe("provider response budget", () => {
  it("preserves HTTP status and UTF-8 split across real network chunks", async () => {
    const url = await fixture((_req, res) => {
      res.writeHead(201, { "x-fixture": "yes" });
      const data = Buffer.from("中文\n");
      res.write(data.subarray(0, 2));
      setTimeout(() => res.end(data.subarray(2)), 10);
    });
    const response = await fetchBoundedResponse(fetch, url, {}, limits);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-fixture")).toBe("yes");
    expect(await response.text()).toBe("中文\n");
  });
  it("rejects an oversized newline-free network body and closes the socket", async () => {
    let closed = false;
    const url = await fixture((_req, res) => {
      res.on("close", () => {
        closed = true;
      });
      res.write("x".repeat(33));
    });
    const response = await fetchBoundedResponse(fetch, url, {}, limits);
    await expect(response.text()).rejects.toThrow("MODEL_RESPONSE_TOO_LARGE");
    await vi.waitFor(() => expect(closed).toBe(true));
  });
  it("cancels the real upstream after a consumer stops at DONE", async () => {
    let closed = false;
    const url = await fixture((_req, res) => {
      res.on("close", () => {
        closed = true;
      });
      res.write("data: [DONE]\n\n");
    });
    const response = await fetchBoundedResponse(fetch, url, {}, limits);
    for await (const frame of readSseLines(response)) {
      expect(frame).toBe("[DONE]");
      break;
    }
    await vi.waitFor(() => expect(closed).toBe(true));
  });
  it("interrupts a quiet pending body read", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const response = await fetchBoundedResponse(
      async () => new Response(new ReadableStream({ cancel: cancelled })),
      "http://fixture",
      {},
      limits,
    );
    const pending = response.text();
    const rejected = expect(pending).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("enforces a total deadline even while bytes keep arriving", async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const response = await fetchBoundedResponse(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              source = c;
            },
          }),
        ),
      "http://fixture",
      {},
      limits,
    );
    const pending = response.text();
    const rejected = expect(pending).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
    for (let i = 0; i < 5; i++) {
      source.enqueue(new Uint8Array([120]));
      await vi.advanceTimersByTimeAsync(500);
    }
    source.enqueue(new Uint8Array([120]));
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors caller cancellation before fetch and during a body read", async () => {
    const abort = new AbortController(),
      fetcher = vi.fn(async () => new Response("no"));
    abort.abort(Error("caller cancelled"));
    await expect(
      fetchBoundedResponse(
        fetcher,
        "http://fixture",
        { signal: abort.signal },
        limits,
      ),
    ).rejects.toThrow("caller cancelled");
    expect(fetcher).not.toHaveBeenCalled();
    const active = new AbortController(),
      cancel = vi.fn();
    const response = await fetchBoundedResponse(
      async () => new Response(new ReadableStream({ cancel })),
      "http://fixture",
      { signal: active.signal },
      limits,
    );
    const pending = response.text();
    const rejected = expect(pending).rejects.toThrow("takeover");
    active.abort(Error("takeover"));
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("validates budgets and preserves network errors", async () => {
    await expect(
      fetchBoundedResponse(
        fetch,
        "http://fixture",
        {},
        { ...limits, maxBytes: 0 },
      ),
    ).rejects.toThrow("MODEL_RESPONSE_CONFIG_INVALID");
    await expect(
      fetchBoundedResponse(
        async () => {
          throw Error("offline");
        },
        "http://fixture",
        {},
        limits,
      ),
    ).rejects.toThrow("offline");
  });
});

it("enforces the deadline before HTTP headers arrive", async () => {
  let closed = false;
  const url = await fixture((req) => {
    req.on("close", () => {
      closed = true;
    });
  });
  await expect(
    fetchBoundedResponse(fetch, url, {}, { ...limits, idleMs: 200 }),
  ).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
  await vi.waitFor(() => expect(closed).toBe(true));
});
it("does not hide an oversized HTTP error body behind its status", async () => {
  const response = await fetchBoundedResponse(
    async () => new Response("x".repeat(33), { status: 429 }),
    "http://fixture",
    {},
    limits,
  );
  await expect(assertOk(response, "fixture")).rejects.toThrow(
    "MODEL_RESPONSE_TOO_LARGE",
  );
});
