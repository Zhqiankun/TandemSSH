import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTandemMcpServer } from "../../mcp/server";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import type { DirectoryRunView } from "../../../types/directory-transfer";
import type { DirectoryAutomation } from "../../collaboration/files/directories";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it.each([
  ["upload", "automatic"],
  ["upload", "collaborative"],
  ["download", "automatic"],
  ["download", "collaborative"],
] as const)(
  "MCP %s directory in %s mode transfers real bytes with per-entry approvals",
  async (direction, mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const local = path.join(
      f.folder,
      direction === "upload" ? "source-tree" : "target-tree",
    );
    await fs.mkdir(local);
    if (direction === "upload") {
      await fs.mkdir(path.join(local, "空目录"));
      await fs.writeFile(path.join(local, "产物.bin"), f.bytes);
    } else {
      await f.remote.mkdir("/srv/source-tree");
      await f.remote.mkdir("/srv/source-tree/空目录");
      await f.remote.write("/srv/source-tree/产物.bin", f.bytes);
    }
    const server = createTandemMcpServer({
      invoke: (method, params, signal) =>
        f.core.invoke(
          f.principal,
          method,
          params,
          signal ?? new AbortController().signal,
        ),
    });
    const client = new Client({ name: "directory-acceptance", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    async function call<T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
      expect(JSON.stringify(r.structuredContent)).not.toContain(local);
      return r.structuredContent!.result as T;
    }
    const inventory = (await client.listTools()).tools.map((t) => t.name);
    expect(inventory).toHaveLength(38);
    expect(inventory).toEqual(
      expect.arrayContaining([
        "preview_directory_transfer",
        "get_directory_transfer",
        "run_directory_transfer",
        "get_directory_run",
        "release_directory_transfer",
      ]),
    );
    const status = await call<{ capabilities: string[] }>("get_status", {});
    expect(status.capabilities).toContain("per-entry-directory-transfers");
    const { id: taskId } = await call<{ id: string }>("start_task", {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      goal: "传输整个目录",
      mode,
    });
    const ticket = f.grants.issue("owner", taskId, {
      windowToken: f.windowToken,
      direction,
      kind: "directory",
    });
    f.grants.claim(f.windowToken, ticket.id);
    const grant = (await f.grants.fulfill(f.windowToken, ticket.id, [local]))
      .grants[0];
    const listed = await call<{ files: Array<{ id: string; kind?: string }> }>(
      "list_authorized_files",
      { taskId },
    );
    expect(listed.files.find((g) => g.id === grant.id)?.kind).toBe("directory");
    await f.authorize(taskId);
    const request = {
      taskId,
      requestId: randomUUID(),
      direction,
      path: direction === "upload" ? "/srv" : "/srv/source-tree",
      localGrantId: grant.id,
      localVersion: grant.version,
    };
    const [submitted, repeatedPreview] = await Promise.all([
      call<{ operationId: string }>("preview_directory_transfer", request),
      call<{ operationId: string }>("preview_directory_transfer", request),
    ]);
    expect(repeatedPreview.operationId).toBe(submitted.operationId);
    async function approveNext() {
      await vi.waitFor(
        () =>
          expect(f.runtime.state(f.human, taskId).state).toBe(
            "awaiting-approval",
          ),
        { timeout: 10000 },
      );
      const op = f.runtime.get(f.human, taskId).operations.at(-1)!;
      expect(op.status).toBe("awaiting-approval");
      await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
      await vi.waitFor(
        () =>
          expect(f.runtime.operation(f.human, taskId, op.id).status).toBe(
            "succeeded",
          ),
        { timeout: 10000 },
      );
    }
    if (mode === "collaborative") await approveNext();
    await vi.waitFor(
      () =>
        expect(
          f.runtime.operation(f.human, taskId, submitted.operationId).status,
        ).toBe("succeeded"),
      { timeout: 10000 },
    );
    expect(
      (
        await call<{ operationId: string }>(
          "preview_directory_transfer",
          request,
        )
      ).operationId,
    ).toBe(submitted.operationId);
    const op = f.runtime.operation(f.human, taskId, submitted.operationId);
    const previewId = op.fileResult!.directoryTransfer!.previewId;
    const page = await call<ReturnType<DirectoryAutomation["page"]>>(
      "get_directory_transfer",
      { taskId, previewId },
    );
    expect(page.entries).toBe(3);
    expect(page.nextOffset).toBeNull();
    if (direction === "upload")
      await expect(f.remote.io.stat("/srv/source-tree")).rejects.toThrow();
    else expect(await fs.readdir(local)).toEqual([]);
    const args = {
      taskId,
      previewId,
      revision: page.revision,
      choices: page.items.map((e) => ({ id: e.id, action: "create" })),
      requestId: randomUUID(),
    };
    const [run, concurrentRun] = await Promise.all([
      call<DirectoryRunView>("run_directory_transfer", args),
      call<DirectoryRunView>("run_directory_transfer", args),
    ]);
    expect(concurrentRun.id).toBe(run.id);
    expect(
      (await call<DirectoryRunView>("run_directory_transfer", args)).id,
    ).toBe(run.id);
    const conflicting = await client.callTool({
      name: "run_directory_transfer",
      arguments: {
        ...args,
        choices: args.choices.map((e) => ({ ...e, action: "skip" })),
      },
    });
    expect(conflicting.isError).toBe(true);
    expect(JSON.stringify(conflicting.structuredContent)).toContain(
      "REQUEST_CONFLICT",
    );
    if (mode === "collaborative") {
      const early = await client.callTool({
        name: "release_directory_transfer",
        arguments: { taskId, previewId },
      });
      expect(early.isError).toBe(true);
      expect(JSON.stringify(early.structuredContent)).toContain(
        "DIRECTORY_IN_PROGRESS",
      );
      for (let i = 0; i < 4; i++) await approveNext();
    }
    await vi.waitFor(
      async () =>
        expect(
          (
            await call<DirectoryRunView>("get_directory_run", {
              taskId,
              runId: run.id,
            })
          ).state,
        ).toBe("completed"),
      { timeout: 10000 },
    );
    const final = await call<DirectoryRunView>("get_directory_run", {
      taskId,
      runId: run.id,
    });
    expect(final.completed).toBe(3);
    expect(final.total).toBe(3);
    expect(f.runtime.get(f.human, taskId).operations).toHaveLength(5);
    if (direction === "upload") {
      expect(await f.remote.read("/srv/source-tree/产物.bin")).toEqual(f.bytes);
      expect((await f.remote.io.stat("/srv/source-tree/空目录")).kind).toBe(
        "directory",
      );
    } else {
      expect(
        await fs.readFile(path.join(local, "source-tree", "产物.bin")),
      ).toEqual(f.bytes);
      expect(
        await fs.readdir(path.join(local, "source-tree", "空目录")),
      ).toEqual([]);
    }
    const completed = await call<ReturnType<DirectoryAutomation["page"]>>(
      "get_directory_transfer",
      { taskId, previewId },
    );
    expect(completed.items.every((e) => e.result?.status === "succeeded")).toBe(
      true,
    );
    expect(
      completed.items.find((e) => e.kind === "file")?.result?.transfer
        ?.verification,
    ).toBe("sha256");
    const changed = { ...f.principal, connectionId: randomUUID() };
    await expect(
      f.core.invoke(
        changed,
        "directories.page",
        { taskId, previewId },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CLIENT_CONNECTION_CHANGED");
    await call("release_directory_transfer", { taskId, previewId });
    expect(
      (
        await call<DirectoryRunView>("get_directory_run", {
          taskId,
          runId: run.id,
        })
      ).state,
    ).toBe("completed");
    await call("finish_task", { taskId });
  },
  30000,
);
