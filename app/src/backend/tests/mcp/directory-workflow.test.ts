import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer } from "../../mcp/server";
import { parentDirectoryWorkflowFixture } from "../../test-helpers/parent-directory-workflow-fixture";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
it.each(["automatic", "collaborative"] as const)(
  "MCP saved directory workflow preserves the %s parent and rejects reused previews",
  async (mode) => {
    const f = await parentDirectoryWorkflowFixture();
    cleanup.push(f.close);
    const server = createTandemMcpServer({
        invoke: (method, p, signal) =>
          f.core.invoke(
            f.principal,
            method,
            p,
            signal ?? new AbortController().signal,
          ),
      }),
      client = new Client({ name: "directory-workflow-test", version: "1" }),
      [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const call = async <T = unknown>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
      return r.structuredContent!.result as T;
    };
    const task = await call<{ id: string }>("start_task", {
        sessionId: f.sessionId,
        goal: "执行目录流程",
        mode,
        requestId: randomUUID(),
      }),
      id = task.id as string,
      bindings = await f.bind(id);
    await f.authorize(id);
    const before = f.control.snapshot(),
      preview = await call<{ id: string }>("preview_workflow", {
        workflowId: f.saved.id,
        sessionId: f.sessionId,
        parentTaskId: id,
        parameters: {},
        fileBindings: bindings,
      }),
      run = await call<{ id: string }>("run_workflow", {
        taskId: id,
        previewId: preview.id,
        requestId: randomUUID(),
      });
    const approve = async () => {
      await vi.waitFor(
        () =>
          expect(f.runtime.state(f.human, id).state).toBe("awaiting-approval"),
        { timeout: 10000 },
      );
      const op = f.runtime.get(f.human, id).operations.at(-1)!;
      await f.runtime.approve(f.human, id, op.id, op.digest, 1);
      await vi.waitFor(
        () =>
          expect(f.runtime.operation(f.human, id, op.id).status).toBe(
            "succeeded",
          ),
        { timeout: 10000 },
      );
    };
    if (mode === "collaborative") for (let i = 0; i < 11; i++) await approve();
    await vi.waitFor(
      () =>
        expect(f.runtime.workflowRunSummary(f.actor, id, run.id).state).toBe(
          "completed",
        ),
      { timeout: 10000 },
    );
    const result = await call<{ operations: Array<{ actionType: string }> }>(
      "get_workflow_run",
      {
        taskId: id,
        workflowRunId: run.id,
      },
    );
    expect(result.operations).toHaveLength(11);
    expect(result.operations[5].actionType).toBe("terminal.command");
    expect(f.runtime.state(f.actor, id).state).toBe("ready");
    expect(f.control.snapshot()).toMatchObject({
      generation: before.generation,
      controlEpoch: before.controlEpoch,
    });
    const used = f.directoryAutomation.previews(f.actor, id)[0],
      page = f.directoryAutomation.page(f.actor, id, used.id);
    const repeated = await client.callTool({
      name: "run_directory_transfer",
      arguments: {
        taskId: id,
        previewId: used.id,
        revision: used.revision,
        choices: page.items.map((e) => ({ id: e.id, action: e.action })),
        requestId: randomUUID(),
      },
    });
    expect(repeated.isError).toBe(true);
    expect(JSON.stringify(repeated.structuredContent)).toContain(
      "DIRECTORY_PREVIEW_USED",
    );
    await call("run_command", {
      taskId: id,
      program: "pwd",
      args: [],
      requestId: randomUUID(),
    });
    if (mode === "collaborative") await approve();
    await vi.waitFor(() =>
      expect(f.runtime.get(f.human, id).operations.at(-1)?.status).toBe(
        "succeeded",
      ),
    );
    expect(
      await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
    ).toEqual(f.bytes);
    expect(f.writes).toEqual(["context", "pwd", "pwd"]);
    expect(JSON.stringify(result)).not.toContain(f.folder);
    await call("finish_task", { taskId: id });
  },
  30000,
);
