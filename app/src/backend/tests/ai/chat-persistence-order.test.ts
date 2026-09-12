import { restoreChatHistory } from "../../ai/chat-history.js";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const state = vi.hoisted(() => ({
  append: vi.fn(),
  page: vi.fn(),
  touch: vi.fn(),
  history: vi.fn(async () => []),
  engineHistory: vi.fn(),
  modelFailure: false,
  pause: false,
  waiting: vi.fn(),
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: object, _res: unknown, next: () => void) => {
          Object.assign(req, { userId: "owner" });
          next();
        },
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));
vi.mock("../../ai/gating.js", () => ({
  createAiGate: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  resolveAiAccess: async () => ({ allowReadOnlyCommands: false }),
  isAiGloballyEnabled: async () => true,
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAiRepository: () => ({
    findProviderWithSecret: async () => ({
      providerType: "openai_compatible",
      defaultModel: "test",
    }),
    createConversation: async () => ({ id: 1 }),
    listMessages: state.history,
    listConversationPage: state.page,
    findConversation: async () => ({ id: 1 }),
    appendMessage: state.append,
    touchConversation: state.touch,
  }),
  createCurrentHostRepository: () => ({ listByUserId: async () => [] }),
}));
vi.mock("../../ai/engine.js", () => ({
  runAgent: async function* (options: {
    history: unknown;
    signal: AbortSignal;
  }) {
    state.engineHistory(options.history);
    yield {
      type: "assistant_message",
      content: "先检查",
      toolCalls: [
        {
          id: "call-1",
          name: "list_hosts",
          arguments: {},
          providerSignature: "opaque",
        },
      ],
    };
    if (state.modelFailure) {
      yield { type: "error", message: "模型服务暂时不可用" };
      return;
    }
    yield {
      type: "tool_message",
      message: {
        role: "tool",
        content: "[]",
        toolCallId: "call-1",
        toolName: "list_hosts",
      },
    };
    yield { type: "token", text: "中文回复" };
    if (state.pause) {
      state.waiting();
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        else
          options.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      return;
    }
    yield { type: "assistant_message", content: "中文回复", toolCalls: [] };
    yield { type: "done" };
  },
}));
vi.mock("../../ai/context.js", () => ({ buildSystemPrompt: () => "test" }));
vi.mock("../../ai/tools/executor.js", () => ({ applyProposal: vi.fn() }));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  getAuditUsername: vi.fn(),
  getRequestMeta: vi.fn(),
  logAudit: vi.fn(),
}));
import router from "../../ai/index.js";
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  vi.clearAllMocks();
  state.modelFailure = false;
  state.pause = false;
});
it.each([false, true])(
  "chat completion is emitted only after persistence (save failure: %s)",
  async (fail) => {
    state.history.mockResolvedValue([]);
    let saved = false,
      touched = false;
    state.append.mockImplementation(async (input: { role: string }) => {
      if (input.role === "assistant") {
        await new Promise((r) => setTimeout(r, 20));
        if (fail) throw Error("fixture save failure");
        saved = true;
      }
    });
    state.touch.mockImplementation(async () => {
      touched = true;
    });
    const completions: Array<{ saved: boolean; touched: boolean }> = [];
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      const write = res.write.bind(res);
      res.write = ((chunk: unknown, ...args: unknown[]) => {
        if (String(chunk).includes('"type":"done"'))
          completions.push({ saved, touched });
        return Reflect.apply(write, res, [chunk, ...args]);
      }) as typeof res.write;
      next();
    });
    app.use("/ai", router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server!.once("listening", r));
    const response = await fetch(
      "http://127.0.0.1:" +
        (server.address() as { port: number }).port +
        "/ai/chat/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: 1, message: "你好" }),
      },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("中文回复");
    if (fail) {
      expect(completions).toEqual([]);
      expect(body).toContain('"type":"error"');
      expect(state.touch).not.toHaveBeenCalled();
    } else {
      expect(completions).toEqual([{ saved: true, touched: true }]);
      expect(body).not.toContain('"type":"error"');
      expect(body).not.toContain('"type":"tool_message"');
      const stored = state.append.mock.calls.find(
        ([m]) => m.role === "assistant",
      )![0];
      expect(stored.content).toBe("先检查中文回复");
      expect(JSON.parse(stored.toolCalls)).toMatchObject({
        version: 1,
        messages: [
          {
            role: "assistant",
            toolCalls: [{ id: "call-1", providerSignature: "opaque" }],
          },
          {
            role: "tool",
            toolCallId: "call-1",
            toolName: "list_hosts",
            content: "[]",
          },
          { role: "assistant", content: "中文回复" },
        ],
      });
      state.history.mockResolvedValue([stored] as never[]);
      const next = await fetch(
        "http://127.0.0.1:" +
          (server.address() as { port: number }).port +
          "/ai/chat/stream",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: 1,
            conversationId: 1,
            message: "继续",
          }),
        },
      );
      expect(next.status).toBe(200);
      await next.text();
      expect(state.engineHistory.mock.calls[1][0]).toEqual([
        ...JSON.parse(stored.toolCalls).messages,
        { role: "user", content: "继续" },
      ]);
    }
  },
);

it("model errors retain a failed record without completing or replaying unmatched calls", async () => {
  state.modelFailure = true;
  state.history.mockResolvedValue([]);
  state.append.mockResolvedValue(undefined);
  const app = express();
  app.use(express.json());
  app.use("/ai", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const response = await fetch(
    "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/ai/chat/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: 1, message: "检查主机" }),
    },
  );
  const body = await response.text();
  expect(body).toContain("模型服务暂时不可用");
  expect(body).not.toContain('"type":"done"');
  expect(state.append.mock.calls.map(([input]) => input.role)).toEqual([
    "user",
    "assistant",
  ]);
  const record = state.append.mock.calls.at(-1)![0];
  expect(JSON.parse(record.toolCalls).outcome).toBe("failed");
  expect(restoreChatHistory([record])).toEqual([]);
  expect(state.touch).toHaveBeenCalledOnce();
});

it("retains received text once when the HTTP client disconnects and excludes it from model replay", async () => {
  state.pause = true;
  state.history.mockResolvedValue([]);
  state.append.mockResolvedValue(undefined);
  const app = express();
  app.use(express.json());
  app.use("/ai", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const abort = new AbortController();
  const response = await fetch(
    "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/ai/chat/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: 1, message: "检查" }),
      signal: abort.signal,
    },
  );
  const reader = response.body!.getReader();
  let received = "";
  while (!received.includes("中文回复")) {
    const part = await reader.read();
    if (part.done) throw Error("premature end");
    received += new TextDecoder().decode(part.value);
  }
  await vi.waitFor(() => expect(state.waiting).toHaveBeenCalledOnce());
  abort.abort();
  await reader.cancel().catch(() => {});
  await vi.waitFor(() =>
    expect(
      state.append.mock.calls.filter(([m]) => m.role === "assistant"),
    ).toHaveLength(1),
  );
  const record = state.append.mock.calls.find(
    ([m]) => m.role === "assistant",
  )![0];
  expect(record.content).toBe("中文回复");
  expect(JSON.parse(record.toolCalls)).toMatchObject({
    outcome: "interrupted",
    messages: expect.any(Array),
  });
  expect(restoreChatHistory([record])).toEqual([]);
});

it("validates pagination at HTTP boundary and passes the authenticated owner separately", async () => {
  state.page.mockResolvedValue({ conversations: [], nextCursor: null });
  const app = express();
  app.use("/ai", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server!.once("listening", r));
  const base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/ai/conversations";
  const cursor = { updatedAt: "2026-09-12 12:00:00", id: 7 };
  const response = await fetch(
    base + "?" + new URLSearchParams({ cursor: JSON.stringify(cursor) }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    conversations: [],
    nextCursor: null,
  });
  expect(state.page).toHaveBeenCalledWith("owner", cursor);
  const invalid = await fetch(
    base +
      "?" +
      new URLSearchParams({
        cursor: JSON.stringify({ ...cursor, userId: "other" }),
      }),
  );
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({
    error: "INVALID_CONVERSATION_CURSOR",
  });
  expect(state.page).toHaveBeenCalledOnce();
});
