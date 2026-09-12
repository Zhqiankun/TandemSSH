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
it.each(["automatic", "collaborative"] as const)(
  "%s workflow tools preserve catalog access but isolate previews and parent tasks",
  async (mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const saved = await f.workflows.save("owner", {
      allowedHostIds: [7],
      definition: {
        schemaVersion: 1,
        id: "inspect",
        name: "目录巡检",
        version: "1.0.0",
        parameters: {},
        defaults: { cwd: "/srv" },
        steps: [
          {
            id: "pwd",
            name: "查看目录",
            action: { type: "command", program: "pwd", args: [] },
          },
        ],
      },
    });
    let principal = f.principal;
    const server = createTandemMcpServer({
      invoke: (m, p, s) =>
        f.core.invoke(principal, m, p, s ?? new AbortController().signal),
    });
    const client = new Client({ name: "workflow-permissions", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
      return r.structuredContent!.result as Record<string, unknown>;
    };
    const task = await f.runtime.create(f.actor, {
      sessionId: f.sessionId,
      requestId: "parent",
      title: "父任务",
      mode,
    });
    await f.authorize(task.id);
    const previewArgs = {
      workflowId: saved.id,
      sessionId: f.sessionId,
      parameters: {},
    };
    const independent = await call("preview_workflow", previewArgs);
    const preview = await call("preview_workflow", {
      ...previewArgs,
      parentTaskId: task.id,
    });
    const runArgs = {
      taskId: task.id,
      previewId: preview.id,
      requestId: "run",
    };
    const run = await call("run_workflow", runArgs);
    if (mode === "collaborative") {
      await vi.waitFor(() =>
        expect(f.runtime.get(f.human, task.id).operations.at(-1)?.status).toBe(
          "awaiting-approval",
        ),
      );
      const op = f.runtime.get(f.human, task.id).operations.at(-1)!;
      await f.runtime.approve(f.human, task.id, op.id, op.digest, 1);
    }
    await vi.waitFor(() =>
      expect(
        f.runtime.workflowRunSummary(f.actor, task.id, run.id as string).state,
      ).toBe("completed"),
    );
    const resultArgs = { taskId: task.id, workflowRunId: run.id };
    const result = await call("get_workflow_run", resultArgs);
    const before = structuredClone(f.runtime.get(f.human, task.id));
    const writes = [...f.writes];
    const control = structuredClone(f.control.snapshot());
    for (const boundary of ["user", "pairing", "host"] as const) {
      principal = {
        ...f.principal,
        ...(boundary === "user" ? { userId: "stranger" } : {}),
        ...(boundary === "pairing" ? { clientId: randomUUID() } : {}),
        ...(boundary === "host" ? { allowedHostIds: [8] } : {}),
      };
      try {
        for (const item of [
          {
            name: "list_workflows",
            arguments: { hostId: 7 },
            error: "HOST_NOT_FOUND",
            catalog: true,
          },
          {
            name: "get_workflow",
            arguments: { hostId: 7, workflowId: saved.id },
            error: "HOST_NOT_FOUND",
            catalog: true,
          },
          {
            name: "preview_workflow",
            arguments: { ...previewArgs, parentTaskId: task.id },
            error:
              boundary === "user"
                ? "WORKFLOW_NOT_FOUND"
                : boundary === "host"
                  ? "SESSION_NOT_FOUND"
                  : "TASK_NOT_FOUND",
          },
          {
            name: "start_workflow",
            arguments: {
              previewId: independent.id,
              requestId: "foreign-start",
              mode,
            },
            error:
              boundary === "host"
                ? "SESSION_NOT_FOUND"
                : "WORKFLOW_PREVIEW_NOT_FOUND",
          },
          {
            name: "run_workflow",
            arguments: runArgs,
            error:
              boundary === "host"
                ? "TASK_NOT_FOUND"
                : "WORKFLOW_PREVIEW_NOT_FOUND",
          },
          {
            name: "get_workflow_run",
            arguments: resultArgs,
            error: "TASK_NOT_FOUND",
          },
        ]) {
          const r = await client.callTool({
            name: item.name,
            arguments: item.arguments,
          });
          if (boundary === "pairing" && item.catalog) {
            expect(r.isError).not.toBe(true);
            expect(JSON.stringify(r.structuredContent)).toContain(saved.id);
          } else {
            expect(r.isError, item.name).toBe(true);
            expect(r.structuredContent, item.name).toMatchObject({
              error: { code: item.error },
            });
            expect(r.structuredContent).not.toHaveProperty("result");
          }
          expect(f.runtime.get(f.human, task.id)).toEqual(before);
          expect(f.control.snapshot()).toEqual(control);
          expect(f.writes).toEqual(writes);
          expect(f.runtime.list(f.human)).toHaveLength(1);
        }
      } finally {
        principal = f.principal;
      }
      expect(await call("get_workflow_run", resultArgs)).toEqual(result);
    }
  },
);
