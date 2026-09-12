import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk } from "../../ai/providers/types.js";

const streamChat = vi.fn();
const handler = vi.fn();

vi.mock("../../ai/providers/registry.js", () => ({
  getAdapter: () => ({ streamChat, listModels: async () => [] }),
}));

vi.mock("../../ai/tools/catalog.js", () => ({
  getTool: (name: string) =>
    name === "list_hosts"
      ? {
          name: "list_hosts",
          description: "List hosts",
          category: "read",
          parameters: { type: "object", properties: {} },
          handler,
        }
      : undefined,
  toolDefinitions: () => [
    { name: "list_hosts", description: "List hosts", parameters: {} },
  ],
}));

const { runAgent } = await import("../../ai/engine.js");

function chunks(...values: ChatChunk[]) {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

const BASE = {
  config: { providerType: "ollama" as const },
  model: "test",
  system: "system",
  context: {
    userId: "user-1",
    conversationId: 1,
    allowReadOnlyCommands: false,
  },
};

async function collect(history: any[] = []) {
  const events: any[] = [];
  for await (const event of runAgent({ ...BASE, history })) {
    events.push(event);
  }
  return events;
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text and finishes when no tools are called", async () => {
    streamChat.mockReturnValueOnce(
      chunks({ type: "text", text: "hello" }, { type: "done" }),
    );

    const events = await collect();

    expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    expect(events.at(-1).type).toBe("done");
  });

  it("runs a known tool and feeds the result back", async () => {
    handler.mockResolvedValue({ hosts: [{ id: 1, name: "web-1" }] });
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    expect(handler).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(events.find((e) => e.type === "tool_message")?.message).toEqual({
      role: "tool",
      content: JSON.stringify({ hosts: [{ id: 1, name: "web-1" }] }),
      toolCallId: "c1",
      toolName: "list_hosts",
    });
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("refuses a tool that is not in the catalog", async () => {
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "read_credentials", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    // A model can emit any name it likes; only the catalog decides what runs.
    expect(handler).not.toHaveBeenCalled();
    const result = events.find((e) => e.type === "tool_result");
    expect(JSON.stringify(result.result)).toContain("Unknown tool");
  });

  it("surfaces a handler failure without ending the run", async () => {
    handler.mockRejectedValue(new Error("database is down"));
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    const result = events.find((e) => e.type === "tool_result");
    expect(JSON.stringify(result.result)).toContain("database is down");
    expect(events.at(-1).type).toBe("done");
  });

  it("closes the tool call when a tool returns a proposal", async () => {
    // Without a matching tool_result the call rendered as permanently
    // running, even though the work was done and awaiting the user.
    handler.mockResolvedValue({
      __proposal: true,
      kind: "propose_create_host",
      summary: "Add host web-1",
      payload: {},
    });
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    const callIndex = events.findIndex((e) => e.type === "tool_call");
    const resultIndex = events.findIndex((e) => e.type === "tool_result");
    const proposalIndex = events.findIndex((e) => e.type === "proposal");

    expect(resultIndex).toBeGreaterThan(callIndex);
    expect(proposalIndex).toBeGreaterThan(resultIndex);
    expect(events[resultIndex]).toMatchObject({
      name: "list_hosts",
      result: { status: "awaiting_user_approval" },
    });
  });

  it("reports a provider failure as an error and stops", async () => {
    streamChat.mockImplementationOnce(() => {
      throw new Error("provider unreachable");
    });

    const events = await collect();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      message: "provider unreachable",
    });
  });

  it("rejects large initial context before requesting a model", async () => {
    const events = await collect([
      { role: "user", content: "x".repeat(128 * 1024) },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: "MODEL_CONTEXT_LIMIT",
    });
    expect(streamChat).not.toHaveBeenCalled();
  });
  it("does not dispatch already received tools when text overflows", async () => {
    streamChat.mockReturnValueOnce(
      chunks(
        {
          type: "tool_call",
          call: { id: "one", name: "list_hosts", arguments: {} },
        },
        { type: "text", text: "x".repeat(16 * 1024 + 1) },
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: "MODEL_RESPONSE_TOO_LARGE",
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it("does not dispatch an oversized batch of tools", async () => {
    streamChat.mockReturnValueOnce(
      chunks(
        ...Array.from({ length: 9 }, (_, i) => ({
          type: "tool_call" as const,
          call: { id: String(i), name: "list_hosts", arguments: {} },
        })),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: "MODEL_TOOL_LIMIT",
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it("stops after an oversized tool result without calling the model again", async () => {
    handler.mockResolvedValue({ output: "x".repeat(64 * 1024) });
    streamChat.mockReturnValueOnce(
      chunks({
        type: "tool_call",
        call: { id: "one", name: "list_hosts", arguments: {} },
      }),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: "MODEL_TOOL_RESULT_LIMIT",
    });
    expect(streamChat).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });
  it("does not dispatch a tool when cancelled while its visible call event is being delivered", async () => {
    const controller = new AbortController();
    streamChat.mockReturnValueOnce(
      chunks({
        type: "tool_call",
        call: { id: "one", name: "list_hosts", arguments: {} },
      }),
    );
    for await (const event of runAgent({
      ...BASE,
      history: [],
      signal: controller.signal,
    })) {
      if (event.type === "tool_call") controller.abort(Error("cancelled"));
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it("stops after too many tool turns", async () => {
    handler.mockResolvedValue({ ok: true });
    streamChat.mockImplementation(() =>
      chunks(
        {
          type: "tool_call",
          call: { id: "c", name: "list_hosts", arguments: {} },
        },
        { type: "done" },
      ),
    );

    const events = await collect();

    // A model that never stops calling tools must not spin forever.
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(streamChat.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
