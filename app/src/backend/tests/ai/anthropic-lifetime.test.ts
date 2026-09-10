import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
}));
import { anthropicAdapter } from "../../ai/providers/anthropic.js";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    providerType: "anthropic" as const,
    apiKey: "isolated-fixture",
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
const request = {
  model: "fixture-model",
  system: "fixture",
  messages: [{ role: "user" as const, content: "hello" }],
  tools: [],
};
it("does not silently retry an Anthropic HTTP failure", async () => {
  let requests = 0;
  const config = await fixture((_req, res) => {
    requests++;
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "rate_limit_error", message: "fixture limit" },
      }),
    );
  });
  await expect(
    (async () => {
      for await (const _ of anthropicAdapter.streamChat(config, request)) {
        /* drain */
      }
    })(),
  ).rejects.toThrow("rate limit");
  expect(requests).toBe(1);
});
it("cancels the actual SDK stream when the consumer exits after text", async () => {
  let closed = false;
  const config = await fixture((_req, res) => {
    res.on("close", () => {
      closed = true;
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: Record<string, unknown>) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        content: [],
        model: "fixture-model",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    });
    send({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    send({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "中文" },
    });
  });
  for await (const chunk of anthropicAdapter.streamChat(config, request)) {
    expect(chunk).toEqual({ type: "text", text: "中文" });
    break;
  }
  await vi.waitFor(() => expect(closed).toBe(true));
});
it("preserves the response size failure through the real SDK", async () => {
  let closed = false;
  const config = await fixture((_req, res) => {
    res.on("close", () => {
      closed = true;
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: " + "x".repeat(8 * 1024 * 1024 + 1));
  });
  await expect(
    (async () => {
      for await (const _ of anthropicAdapter.streamChat(config, request)) {
        /* drain */
      }
    })(),
  ).rejects.toThrow("MODEL_RESPONSE_TOO_LARGE");
  await vi.waitFor(() => expect(closed).toBe(true));
});
