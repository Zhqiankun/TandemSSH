import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer } from "../../mcp/server";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it.each(["automatic", "collaborative"] as const)(
  "MCP %s mode transfers exact bytes, exposes progress and preserves request identity",
  async (mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const server = createTandemMcpServer({
        invoke: (method, params, signal) =>
          f.core.invoke(
            f.principal,
            method,
            params,
            signal ?? new AbortController().signal,
          ),
      }),
      client = new Client({ name: "codex-transfer-test", version: "1" }),
      [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
        true,
      );
      return result.structuredContent!.result as Record<string, unknown>;
    };
    expect((await client.listTools()).tools).toHaveLength(34);
    const task = await call("start_task", {
        sessionId: f.sessionId,
        requestId: randomUUID(),
        goal: "上传、执行命令、下载",
        mode,
      }),
      taskId = task.id as string;
    await f.select(taskId);
    const listed = await call("list_authorized_files", { taskId });
    expect(JSON.stringify(listed)).not.toContain(f.folder);
    const files = listed.files as Array<{
      id: string;
      version: string;
      direction: string;
    }>;
    await f.authorize(taskId);
    for (const direction of ["upload", "download"] as const) {
      const grant = files.find((g) => g.direction === direction)!,
        requestId = randomUUID(),
        args = {
          taskId,
          requestId,
          path: "/srv/data.bin",
          localGrantId: grant.id,
          localVersion: grant.version,
        };
      const submitted = await call(direction + "_file", args),
        operationId = submitted.operationId as string;
      if (mode === "collaborative") {
        await vi.waitFor(() =>
          expect(f.runtime.operation(f.human, taskId, operationId).status).toBe(
            "awaiting-approval",
          ),
        );
        const waiting = await call("get_transfer_status", {
          taskId,
          operationId,
        });
        expect(waiting.status).toBe("awaiting-approval");
        expect(waiting.progress).toBeNull();
        const op = f.runtime.operation(f.human, taskId, operationId);
        await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
      }
      await vi.waitFor(
        () =>
          expect(f.runtime.operation(f.human, taskId, operationId).status).toBe(
            "succeeded",
          ),
        { timeout: 10000 },
      );
      const status = await call("get_transfer_status", { taskId, operationId });
      expect(status.status).toBe("succeeded");
      expect(
        (status.fileResult as { transfer: { verification: string } }).transfer
          .verification,
      ).toBe("sha256");
      if (direction === "upload") {
        expect(await f.remote.read("/srv/data.bin")).toEqual(f.bytes);
        const cmd = await call("run_command", {
          taskId,
          requestId: randomUUID(),
          program: "pwd",
          args: [],
        });
        const command = (cmd.operation ?? cmd) as { id: string };
        if (mode === "collaborative") {
          await vi.waitFor(() =>
            expect(
              f.runtime.operation(f.human, taskId, command.id).status,
            ).toBe("awaiting-approval"),
          );
          const op = f.runtime.operation(f.human, taskId, command.id);
          await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
        }
        await vi.waitFor(() =>
          expect(f.runtime.operation(f.human, taskId, command.id).status).toBe(
            "succeeded",
          ),
        );
      } else expect(await fs.readFile(f.destination)).toEqual(f.bytes);
      expect((await call(direction + "_file", args)).operationId).toBe(
        operationId,
      );
      await call("release_transfer", { taskId, operationId });
      expect(
        (await call("get_transfer_status", { taskId, operationId })).status,
      ).toBe("succeeded");
    }
    expect(f.writes).toEqual(["context", "pwd"]);
    const bad = await client.callTool({
      name: "upload_file",
      arguments: {
        taskId,
        requestId: randomUUID(),
        path: "/srv/x",
        localGrantId: files[0].id,
        localVersion: files[0].version,
        localPath: f.source,
      },
    });
    expect(bad.isError).toBe(true);
    await call("finish_task", { taskId });
  },
  30000,
);
it("keeps progress readable after takeover but rejects a different MCP connection", async () => {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const t = (await f.core.invoke(
    f.principal,
    "tasks.create",
    {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      goal: "transfer",
      mode: "automatic",
    },
    new AbortController().signal,
  )) as { id: string };
  const grants = await f.select(t.id);
  await f.authorize(t.id);
  const submitted = await f.automation.submit(
    f.actor,
    t.id,
    {
      path: "/srv/data.bin",
      localGrantId: grants[0].id,
      localVersion: grants[0].version,
    },
    randomUUID(),
    "upload",
  );
  await vi.waitFor(() =>
    expect(
      f.runtime.operation(f.human, t.id, submitted.operationId).status,
    ).toBe("succeeded"),
  );
  f.runtime.takeover(f.human, f.sessionId);
  expect(
    f.automation.progress(f.actor, t.id, submitted.operationId).status,
  ).toBe("succeeded");
  await expect(
    f.automation.submit(
      f.actor,
      t.id,
      {
        path: "/srv/next",
        localGrantId: grants[0].id,
        localVersion: grants[0].version,
      },
      randomUUID(),
      "upload",
    ),
  ).rejects.toThrow();
  const changed = { ...f.principal, connectionId: randomUUID() };
  await expect(
    f.core.invoke(
      changed,
      "transfers.local",
      { taskId: t.id },
      new AbortController().signal,
    ),
  ).rejects.toThrow("CLIENT_CONNECTION_CHANGED");
}, 30000);
