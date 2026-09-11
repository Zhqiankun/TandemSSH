import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
}));
import { providerFetch, readSseLines } from "../../ai/providers/http.js";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
describe("provider HTTP transport compatibility", () => {
  it("uses the packaged HTTP client and dispatcher together for real loopback requests", async () => {
    const server = createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer test-only");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"text":"中文模型响应"}\n\n');
      res.end("data: [DONE]\n\n");
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const response = await providerFetch(
      "http://127.0.0.1:" + address.port + "/chat",
      { headers: { Authorization: "Bearer test-only" } },
    );
    expect(response.status).toBe(200);
    const frames: string[] = [];
    for await (const frame of readSseLines(response)) frames.push(frame);
    expect(frames).toEqual(['{"text":"中文模型响应"}', "[DONE]"]);
  });
});
it("uses a custom provider prefix, key and model for real model discovery and streamed tools", async () => {
  const { openAiAdapter } = await import("../../ai/providers/openai.js");
  const requests: Array<{
    path: string;
    authorization?: string;
    body: string;
  }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({
      path: req.url!,
      authorization: req.headers.authorization,
      body,
    });
    if (req.url === "/custom/provider/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "my-private-model" }] }));
      return;
    }
    if (req.url !== "/custom/provider/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const delta of [
      { content: "中文检查计划" },
      {
        tool_calls: [
          {
            index: 0,
            id: "cmd",
            function: { name: "run_command", arguments: '{"program":"pwd",' },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: '"args":[]}' } }] },
    ])
      res.write("data: " + JSON.stringify({ choices: [{ delta }] }) + "\n\n");
    res.end("data: [DONE]\n\n");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    providerType: "openai_compatible" as const,
    baseUrl:
      "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/custom/provider/v1/",
    apiKey: "user-selected-fixture-key",
  };
  expect(await openAiAdapter.listModels(config)).toEqual(["my-private-model"]);
  const chunks = [];
  for await (const chunk of openAiAdapter.streamChat(config, {
    model: "my-private-model",
    system: "只在授权内执行",
    messages: [{ role: "user", content: "检查目录" }],
    tools: [
      {
        name: "run_command",
        description: "运行受控命令",
        parameters: {
          type: "object",
          properties: { program: { type: "string" } },
        },
      },
    ],
  }))
    chunks.push(chunk);
  expect(requests.map((r) => r.path)).toEqual([
    "/custom/provider/v1/models",
    "/custom/provider/v1/chat/completions",
  ]);
  expect(
    requests.every(
      (r) => r.authorization === "Bearer user-selected-fixture-key",
    ),
  ).toBe(true);
  expect(JSON.parse(requests[1].body)).toMatchObject({
    model: "my-private-model",
    stream: true,
    tools: [{ type: "function", function: { name: "run_command" } }],
  });
  expect(requests[1].body).not.toContain(config.apiKey);
  expect(chunks).toContainEqual({ type: "text", text: "中文检查计划" });
  expect(chunks).toContainEqual({
    type: "tool_call",
    call: {
      id: "cmd",
      name: "run_command",
      arguments: { program: "pwd", args: [] },
    },
  });
});
