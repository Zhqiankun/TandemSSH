import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { automatedFilesFixture } from "../../test-helpers/automated-files-fixture";
import { FileInspectionStore } from "../../files/inspection";
import { fileScopeAllows } from "../../collaboration/policies/file-policy";
import { validateFileResult } from "../../collaboration/operations/file-result";
import type { FileOperationGuard } from "../../collaboration/operations/gateway";
import type { FileDirectoryView } from "../../../types/file-inspection";
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
const fixture = (...args: Parameters<typeof automatedFilesFixture>) => {
  const f = automatedFilesFixture(...args);
  cleanup.push(f.close);
  return f;
};
describe("directory and metadata operations", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode inspects through MCP, pages a stable snapshot and hides denied children",
    async (mode) => {
      const f = fixture("body-must-not-be-read", mode, {
        policy: {
          revision: 1,
          sets: [
            {
              id: "host",
              scope: { type: "host", id: "7" },
              strictAllowlist: false,
              rules: [],
              fileRules: [
                {
                  id: "secret",
                  effect: "deny",
                  reason: "隐藏",
                  match: {
                    kind: "path",
                    path: "/srv/secret",
                    access: ["read"],
                  },
                },
              ],
            },
          ],
        },
      });
      f.put("/srv/secret", "hidden body");
      f.put("/srv/中文.txt", "正文");
      f.put("/srv/sub/child", "child body");
      const read = vi.spyOn(f.io, "snapshot"),
        list = vi.spyOn(f.io, "list"),
        id = await f.start();
      async function call(
        method: "files.list" | "files.stat",
        value: Record<string, unknown>,
      ) {
        const sent = (await f.call(method, {
          taskId: id,
          requestId: randomUUID(),
          ...value,
        })) as { operationId: string };
        if (mode === "collaborative") {
          const before = f.opened.length;
          const op = await f.wait(id, sent.operationId, "awaiting-approval");
          expect(f.opened).toHaveLength(before);
          await f.runtime.approve(f.human, id, op.id, op.digest, 1);
        }
        return f.wait(id, sent.operationId, "succeeded");
      }
      const first = (await call("files.list", { path: "/srv", pageSize: 1 }))
        .fileResult!.directory!;
      expect(first.entries.map((e) => e.name)).toEqual(["config"]);
      expect(first.total).toBe(3);
      expect(first.omitted).toBe(1);
      expect(first.contentTrust).toBe("untrusted-directory-entries");
      expect(JSON.stringify(first)).not.toContain("secret");
      f.put("/srv/later", "new file");
      const second = (
        await call("files.list", {
          path: "/srv",
          cursor: first.nextCursor,
          pageSize: 100,
        })
      ).fileResult!.directory!;
      expect(second.snapshotId).toBe(first.snapshotId);
      expect(second.entries.map((e) => e.name)).toEqual(["sub", "中文.txt"]);
      expect(second.nextCursor).toBeUndefined();
      expect(list).toHaveBeenCalledTimes(1);
      const stat = (await call("files.stat", { path: "/srv/config" }))
        .fileResult!.metadata!;
      expect(stat).toMatchObject({
        path: "/srv/config",
        followedLinks: false,
        metadata: { kind: "file", mode: 0o640 },
      });
      const summary = (await f.call("tasks.get", { taskId: id })) as {
        operations: Array<{
          id: string;
          fileResult?: unknown;
          directorySummary?: { entryCount: number };
        }>;
      };
      expect(summary.operations[0].fileResult).toBeUndefined();
      expect(summary.operations[0].directorySummary).toMatchObject({
        entryCount: 1,
      });
      const detail = (await f.call("operations.get", {
        taskId: id,
        operationId: summary.operations[0].id,
      })) as { fileResult: { directory: FileDirectoryView } };
      expect(detail.fileResult.directory.entries).toEqual(first.entries);
      expect(read).not.toHaveBeenCalled();
      expect(f.writes).toEqual(["context"]);
    },
  );
  it("requires directory read scope for listing, and does not grant read through write permission", () => {
    expect(
      fileScopeAllows([{ kind: "path", path: "/srv", access: ["read"] }], {
        type: "file.list",
        path: "/srv",
      }),
    ).toBe(false);
    expect(
      fileScopeAllows(
        [{ kind: "directory", path: "/srv", access: ["write"] }],
        { type: "file.stat", path: "/srv/config" },
      ),
    ).toBe(false);
    expect(
      fileScopeAllows([{ kind: "directory", path: "/srv", access: ["read"] }], {
        type: "file.list",
        path: "/srv",
        canonicalPath: "/outside",
      }),
    ).toBe(false);
  });
  it("does not follow the final link unless requested, and refuses an unauthorized resolved target before stat", async () => {
    const f = fixture(),
      id = await f.start(),
      oldStat = f.io.stat;
    vi.spyOn(f.io, "resolve").mockImplementation(async (path) =>
      path === "/srv/link" ? "/private/key" : path,
    );
    const stat = vi
      .spyOn(f.io, "stat")
      .mockImplementation(async (path) =>
        path === "/srv/link"
          ? { ...(await oldStat("/srv/config")), kind: "symlink" }
          : oldStat(path),
      );
    const first = await f.files.inspect(
      f.actor,
      id,
      { path: "/srv/link" },
      "link",
      "stat",
    );
    expect(
      (await f.wait(id, first.operationId, "succeeded")).fileResult!.metadata!
        .metadata.kind,
    ).toBe("symlink");
    const follow = await f.files.inspect(
      f.actor,
      id,
      { path: "/srv/link", followLinks: true },
      "follow",
      "stat",
    );
    const denied = await f.wait(id, follow.operationId, "failed");
    expect(denied.error).toBe("FILE_SCOPE_EXCEEDED");
    expect(stat).not.toHaveBeenCalledWith("/private/key");
  });
  it("takeover during directory I/O returns no list and stops further reads", async () => {
    const f = fixture(),
      id = await f.start();
    vi.spyOn(f.io, "list").mockImplementation(async (_p, _max, guard) => {
      f.control.takeover();
      guard();
      return [];
    });
    const sent = await f.files.inspect(
      f.actor,
      id,
      { path: "/srv" },
      "takeover",
      "list",
    );
    const op = await f.wait(id, sent.operationId, "unknown");
    expect(op.fileResult?.directory).toBeUndefined();
    expect(f.writes).toEqual(["context"]);
  });
  it("cursors are bound to task and control epoch and expire; directory handles are not retained", async () => {
    const f = fixture();
    f.put("/srv/second", "b");
    const store = new FileInspectionStore();
    cleanup.push(() => store.clear());
    const context = {
        userId: "owner",
        taskId: "task",
        sessionId: "session",
        control: { generation: 1, controlEpoch: 1 },
      },
      target = { key: "host", connection: "1", io: f.io, check: () => {} };
    const guard: FileOperationGuard = Object.assign(() => {}, {
      canListEntry: () => true,
    });
    const first = (
      await store.inspect(
        { type: "file.list", path: "/srv", pageSize: 1 },
        context,
        target,
        guard,
      )
    ).directory!;
    for (const other of [
      { ...context, taskId: "other" },
      { ...context, control: { generation: 1, controlEpoch: 2 } },
    ])
      await expect(
        store.inspect(
          { type: "file.list", path: "/srv", cursor: first.nextCursor },
          other,
          target,
          guard,
        ),
      ).rejects.toThrow("FILE_DIRECTORY_CURSOR_EXPIRED");
    await expect(
      store.inspect(
        { type: "file.list", path: "/srv", cursor: first.nextCursor },
        context,
        { ...target, connection: "reconnected" },
        guard,
      ),
    ).rejects.toThrow("FILE_DIRECTORY_CURSOR_EXPIRED");
    vi.spyOn(Date, "now").mockReturnValue(first.observedAt + 300001);
    await expect(
      store.inspect(
        { type: "file.list", path: "/srv", cursor: first.nextCursor },
        context,
        target,
        guard,
      ),
    ).rejects.toThrow("FILE_DIRECTORY_CURSOR_EXPIRED");
    vi.restoreAllMocks();
  });
  it("validates directory result provenance, pagination, duplicate names and excludes file bodies", () => {
    const id = randomUUID(),
      metadata = {
        kind: "file" as const,
        size: 1,
        mtime: 1,
        atime: 1,
        mode: 0o640,
        uid: 1,
        gid: 1,
      };
    const directory: FileDirectoryView = {
      path: "/srv",
      canonicalPath: "/srv",
      snapshotId: id,
      observedAt: 1,
      entries: [{ name: "a", metadata }],
      offset: 0,
      total: 1,
      omitted: 0,
      contentTrust: "untrusted-directory-entries",
    };
    const result = { status: "succeeded", result: { directory } },
      action = { type: "file.list" as const, path: "/srv" };
    expect(validateFileResult(result, action, "/srv")).toMatchObject(result);
    expect(() => validateFileResult(result, action, "/other")).toThrow(
      "INVALID_FILE_RESULT",
    );
    for (const patch of [
      { entries: [...directory.entries, ...directory.entries], total: 2 },
      { entries: [{ name: "../escape", metadata }] },
      { nextCursor: id + ":1" },
      { total: 0 },
    ])
      expect(() =>
        validateFileResult({
          status: "succeeded",
          result: { directory: { ...directory, ...patch } },
        }),
      ).toThrow("INVALID_FILE_RESULT");
    expect(() =>
      validateFileResult({
        status: "succeeded",
        result: { directory, content: "private" },
      }),
    ).toThrow("INVALID_FILE_RESULT");
    expect(() =>
      validateFileResult(
        { status: "succeeded", result: { bytes: 0 } },
        action,
        "/srv",
      ),
    ).toThrow("INVALID_FILE_RESULT");
  });
});

it("bounds cached directory snapshots and recovers capacity after clearing", async () => {
  const f = fixture();
  const store = new FileInspectionStore();
  cleanup.push(() => store.clear());
  const context = {
      userId: "owner",
      taskId: "task",
      sessionId: "session",
      control: { generation: 1, controlEpoch: 1 },
    },
    target = { key: "host", connection: "1", io: f.io, check: () => {} };
  const guard: FileOperationGuard = Object.assign(() => {}, {
    canListEntry: () => true,
  });
  for (let i = 0; i < 64; i++)
    await store.inspect(
      { type: "file.list", path: "/srv" },
      context,
      target,
      guard,
    );
  await expect(
    store.inspect({ type: "file.list", path: "/srv" }, context, target, guard),
  ).rejects.toThrow("FILE_DIRECTORY_CACHE_FULL");
  store.clear();
  await expect(
    store.inspect({ type: "file.list", path: "/srv" }, context, target, guard),
  ).resolves.toHaveProperty("directory");
});
