import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer } from "../../mcp/server";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it.each(["automatic", "collaborative"] as const)(
  "%s MCP command after human takeover returns a control error and writes no bytes",
  async (mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const server = createTandemMcpServer({
      invoke: (method, parameters, signal) =>
        f.core.invoke(
          f.principal,
          method,
          parameters,
          signal ?? new AbortController().signal,
        ),
    });
    const client = new Client({ name: "control-contract-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const started = await client.callTool({
      name: "start_task",
      arguments: {
        sessionId: f.sessionId,
        goal: "验证接管拒绝写入",
        mode,
        requestId: "start",
      },
    });
    expect(started.isError).not.toBe(true);
    const taskId = (started.structuredContent!.result as { id: string }).id;
    await f.authorize(taskId);
    const proposed = await client.callTool({
      name: "run_command",
      arguments: {
        taskId,
        requestId: "before-takeover",
        program: "pwd",
        args: [],
      },
    });
    expect(proposed.isError).not.toBe(true);
    const operationId = (
      proposed.structuredContent!.result as { operation: { id: string } }
    ).operation.id;
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.human, taskId, operationId).status).toBe(
        mode === "automatic" ? "succeeded" : "awaiting-approval",
      ),
    );
    f.control.humanInput(Buffer.from("manual\r"));
    const expectedStatus =
      mode === "automatic" ? "succeeded" : "cancelled-before-send";
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.human, taskId, operationId).status).toBe(
        expectedStatus,
      ),
    );
    for (const name of ["get_operation", "wait_operation"]) {
      const observed = await client.callTool({
        name,
        arguments: {
          taskId,
          operationId,
          ...(name === "wait_operation" ? { timeoutMs: 0 } : {}),
        },
      });
      expect(observed.isError).not.toBe(true);
      expect(observed.structuredContent).toMatchObject({
        result: {
          id: operationId,
          status: expectedStatus,
        },
      });
    }
    expect(f.writes.filter((value) => value === "pwd")).toHaveLength(
      mode === "automatic" ? 1 : 0,
    );
    const before = [...f.writes];
    const result = await client.callTool({
      name: "run_command",
      arguments: {
        taskId,
        requestId: "after-takeover",
        program: "pwd",
        args: [],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: expect.stringMatching(/^(CONTROL_BUSY|STALE_CONTROL)$/),
      },
    });
    expect(f.writes).toEqual(before);
    expect(f.control.snapshot().controller.kind).toBe("human");
  },
);
