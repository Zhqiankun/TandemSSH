import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer } from "../../mcp/server";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

for (const mode of ["automatic", "collaborative"] as const) {
  it.each(["other-user", "other-pairing", "unlisted-host"] as const)(
    `${mode}: %s cannot observe or mutate another task through MCP`,
    async (boundary) => {
      const f = await transferToolsFixture();
      cleanup.push(f.close);
      const task = await f.runtime.create(f.actor, {
        sessionId: f.sessionId,
        requestId: "owner-task",
        title: "任务权限验收",
        mode,
      });
      await f.authorize(task.id);
      const proposed = await f.runtime.submit(
        f.actor,
        task.id,
        { program: "pwd", args: [] },
        "owner-operation",
      );
      const op = proposed.operations[0];
      await vi.waitFor(() =>
        expect(f.runtime.operation(f.human, task.id, op.id).status).toBe(
          mode === "automatic" ? "succeeded" : "awaiting-approval",
        ),
      );
      const principal = {
        ...f.principal,
        ...(boundary === "other-user" ? { userId: "different-owner" } : {}),
        ...(boundary === "other-pairing" ? { clientId: randomUUID() } : {}),
        ...(boundary === "unlisted-host" ? { allowedHostIds: [8] } : {}),
      };
      const server = createTandemMcpServer({
        invoke: (method, parameters, signal) =>
          f.core.invoke(
            principal,
            method,
            parameters,
            signal ?? new AbortController().signal,
          ),
      });
      const client = new Client({
        name: "task-permission-matrix",
        version: "1",
      });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(b);
      await client.connect(a);
      cleanup.push(async () => {
        await client.close();
        await server.close();
      });
      const before = structuredClone(f.runtime.get(f.human, task.id));
      const writes = [...f.writes];
      const control = structuredClone(f.control.snapshot());
      const requests = [
        { name: "get_task", arguments: { taskId: task.id } },
        {
          name: "get_operation",
          arguments: { taskId: task.id, operationId: op.id },
        },
        {
          name: "wait_operation",
          arguments: { taskId: task.id, operationId: op.id, timeoutMs: 0 },
        },
        {
          name: "run_command",
          arguments: {
            taskId: task.id,
            requestId: "intruder",
            program: "pwd",
            args: [],
          },
        },
        { name: "finish_task", arguments: { taskId: task.id } },
        { name: "cancel_task", arguments: { taskId: task.id } },
        { name: "list_authorized_files", arguments: { taskId: task.id } },
      ];
      for (const request of requests) {
        const result = await client.callTool(request);
        expect(result.isError, request.name).toBe(true);
        expect(result.structuredContent, request.name).toMatchObject({
          error: { code: "TASK_NOT_FOUND" },
        });
        expect(result.structuredContent).not.toHaveProperty("result");
        expect(f.runtime.get(f.human, task.id), request.name).toEqual(before);
        expect(f.control.snapshot(), request.name).toEqual(control);
        expect(f.writes, request.name).toEqual(writes);
      }
    },
  );
}
