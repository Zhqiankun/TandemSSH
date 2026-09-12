import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const state = vi.hoisted(() => ({
  append: vi.fn(),
  touch: vi.fn(),
  history: vi.fn(async () => []),
  engineHistory: vi.fn(),
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
    findConversation: async () => ({ id: 1 }),
    appendMessage: state.append,
    touchConversation: state.touch,
  }),
  createCurrentHostRepository: () => ({ listByUserId: async () => [] }),
}));
vi.mock("../../ai/engine.js", () => ({
  runAgent: async function* (options: { history: unknown }) {
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
