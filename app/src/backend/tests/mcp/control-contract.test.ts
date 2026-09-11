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

it.each(["automatic", "collaborative"] as const)(
  "deduplicates concurrent MCP retries and rejects changed payloads in %s mode",
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
    const client = new Client({ name: "idempotency-contract", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const input = {
      sessionId: f.sessionId,
      goal: "并发重试验收",
      mode,
      requestId: "same-task",
    };
    const started = await Promise.all([
      client.callTool({ name: "start_task", arguments: input }),
      client.callTool({ name: "start_task", arguments: input }),
    ]);
    for (const result of started) expect(result.isError).not.toBe(true);
    const taskId = (started[0].structuredContent!.result as { id: string }).id;
    expect((started[1].structuredContent!.result as { id: string }).id).toBe(
      taskId,
    );
    expect(f.runtime.list(f.human)).toHaveLength(1);
    await f.authorize(taskId);
    const command = {
      taskId,
      requestId: "same-command",
      program: "pwd",
      args: [],
    };
    const proposed = await Promise.all([
      client.callTool({ name: "run_command", arguments: command }),
      client.callTool({ name: "run_command", arguments: command }),
    ]);
    for (const result of proposed)
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
        true,
      );
    const op = (
      proposed[0].structuredContent!.result as {
        operation: { id: string; digest: string };
      }
    ).operation;
    expect(
      (proposed[1].structuredContent!.result as { operation: { id: string } })
        .operation.id,
    ).toBe(op.id);
    if (mode === "collaborative") {
      await vi.waitFor(() =>
        expect(f.runtime.operation(f.human, taskId, op.id).status).toBe(
          "awaiting-approval",
        ),
      );
      expect(f.writes.filter((value) => value === "pwd")).toHaveLength(0);
      await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
    }
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.human, taskId, op.id).status).toBe(
        "succeeded",
      ),
    );
    const retried = await client.callTool({
      name: "run_command",
      arguments: command,
    });
    expect(retried.isError).not.toBe(true);
    expect(retried.structuredContent).toMatchObject({
      result: { operation: { id: op.id, status: "succeeded" } },
    });
    const changed = await client.callTool({
      name: "run_command",
      arguments: { ...command, args: ["-L"] },
    });
    expect(changed.isError).toBe(true);
    expect(changed.structuredContent).toMatchObject({
      error: { code: "REQUEST_CONFLICT" },
    });
    expect(f.runtime.get(f.human, taskId).operations).toHaveLength(1);
    expect(f.writes.filter((value) => value === "pwd")).toHaveLength(1);
  },
);
