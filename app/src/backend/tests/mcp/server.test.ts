import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer, type CoreMethod } from "../../mcp/server.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
async function connect(fail = false) {
  const calls: Array<{
    method: CoreMethod;
    parameters: Record<string, unknown>;
  }> = [];
  const server = createTandemMcpServer({
    invoke: async (method, parameters) => {
      calls.push({ method, parameters });
      if (fail) throw new Error("POLICY_DENIED");
      return { state: "awaiting-approval", source: "desktop" };
    },
  });
  const client = new Client({ name: "codex-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, calls };
}
const taskId = "11111111-1111-4111-8111-111111111111";

describe("Codex-facing MCP tools", () => {
  it("publishes Chinese tool descriptions without a grant signer or raw input tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("run_command");
    expect(names).toContain("start_task");
    expect(names).not.toContain("approve_operation");
    expect(names).not.toContain("grant_control");
    expect(names).not.toContain("send_input");
    expect(
      tools.every((tool) => /[\u3400-\u9fff]/.test(tool.description ?? "")),
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "run_command")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  });
  it("forwards validated actions and preserves an awaiting-approval result", async () => {
    const { client, calls } = await connect();
    const result = await client.callTool({
      name: "run_command",
      arguments: { taskId, requestId: "cmd-1", program: "pwd", args: [] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      result: { state: "awaiting-approval", source: "desktop" },
    });
    expect(calls).toEqual([
      {
        method: "commands.propose",
        parameters: { taskId, requestId: "cmd-1", program: "pwd", args: [] },
      },
    ]);
  });
  it("rejects a model-supplied manual identity before forwarding anything", async () => {
    const { client, calls } = await connect();
    const result = await client.callTool({
      name: "run_command",
      arguments: {
        taskId,
        requestId: "cmd-1",
        program: "pwd",
        args: [],
        origin: "manual-terminal",
      },
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
  it("returns a Chinese policy error instead of claiming execution", async () => {
    const { client } = await connect(true);
    const result = await client.callTool({
      name: "run_command",
      arguments: { taskId, requestId: "cmd-1", program: "pwd", args: [] },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "POLICY_DENIED" },
    });
    expect(JSON.stringify(result.content)).toContain("规则禁止");
  });
});

it("exposes checkpoint recovery without allowing MCP to supply a reconciliation decision or grant", async () => {
  const { client, calls } = await connect();
  const restored = await client.callTool({
    name: "restore_task_progress",
    arguments: { id: taskId, sessionId: taskId },
  });
  expect(restored.isError).not.toBe(true);
  expect(calls).toEqual([
    {
      method: "recovery.restore",
      parameters: { id: taskId, sessionId: taskId },
    },
  ]);
  const invalid = await client.callTool({
    name: "restore_task_progress",
    arguments: {
      id: taskId,
      sessionId: taskId,
      reconciliation: "skip",
      origin: "human",
    },
  });
  expect(invalid.isError).toBe(true);
  expect(calls).toHaveLength(1);
});
