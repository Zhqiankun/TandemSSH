import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import { readCheckpoint } from "../../collaboration/recovery/schema";
import type { TaskExecutionCheckpoint } from "../../../types/task-recovery";
import type { TaskFileBindings } from "../../../types/task-plan";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function savedDownloadDirectory(
  mode: "automatic" | "collaborative",
  beforeSave?: (
    f: Awaited<ReturnType<typeof transferToolsFixture>>,
    taskId: string,
  ) => Promise<void>,
) {
  const f = await transferToolsFixture();
  cleanups.push(f.close);
  const source = path.join(f.folder, "received");
  await fs.mkdir(source);
  await f.remote.mkdir("/srv/bundle");
  await f.remote.write("/srv/bundle/a.bin", f.bytes);
  await f.remote.write("/srv/bundle/b.bin", "remaining");
  const saved = await f.workflows.save("owner", {
    allowedHostIds: [7],
    definition: {
      schemaVersion: 3,
      id: "recover-directory",
      name: "恢复目录下载",
      version: "1.0.0",
      parameters: {},
      files: { artifact: { direction: "download", kind: "directory" } },
      defaults: { cwd: "/srv" },
      steps: [
        {
          id: "up",
          name: "下载目录",
          action: {
            type: "download-directory",
            path: "/srv/bundle",
            localFile: "artifact",
          },
        },
        {
          id: "after",
          name: "下载后继续",
          action: { type: "command", program: "pwd", args: [] },
        },
      ],
    },
  });
  const preview = f.workflows.preview(f.human, {
    workflowId: saved.id,
    sessionId: f.sessionId,
    parameters: {},
  });
  const task = await f.workflows.start(f.human, preview.id, randomUUID(), mode);
  const select = async (id: string): Promise<TaskFileBindings> => {
    const ticket = f.grants.issue("owner", id, {
      windowToken: f.windowToken,
      direction: "download",
      kind: "directory",
    });
    f.grants.claim(f.windowToken, ticket.id);
    const g = (await f.grants.fulfill(f.windowToken, ticket.id, [source]))
      .grants[0];
    return { artifact: { localGrantId: g.id, localVersion: g.version } };
  };
  const authorize = (id: string, bindings: TaskFileBindings) =>
    f.runtime.authorize(f.human, id, {
      ...f.control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 20,
      durationMinutes: 10,
      allowReviewedPlan: true,
      planRevision: f.runtime.state(f.human, id).planRevision,
      fileScopes: [
        { kind: "directory", path: "/srv", access: ["read", "write"] },
      ],
      fileBindings: bindings,
    });
  const approve = async (id: string) => {
    const op = f.runtime.get(f.human, id).operations.at(-1)!;
    await f.runtime.approve(f.human, id, op.id, op.digest, 1);
  };
  let paused = false;
  const off = f.runtime.observeTask(f.human, task.id, () => {
    if (paused) return;
    const done = f.runtime
      .get(f.human, task.id)
      .operations.some(
        (o) =>
          o.action.type === "file.directory.entry" &&
          o.action.path === "/srv/bundle/a.bin" &&
          o.status === "succeeded",
      );
    if (done) {
      paused = true;
      f.runtime.takeover(f.human, f.sessionId);
    }
  });
  await authorize(task.id, await select(task.id));
  if (mode === "collaborative")
    for (let i = 0; i < 6 && !paused; i++) {
      await vi.waitFor(
        () =>
          expect(
            paused ||
              f.runtime.state(f.human, task.id).state === "awaiting-approval",
          ).toBe(true),
        { timeout: 10000 },
      );
      if (!paused) await approve(task.id);
    }
  await vi.waitFor(
    () => expect(f.runtime.state(f.human, task.id).state).toBe("paused-human"),
    { timeout: 10000 },
  );
  off();
  expect(paused).toBe(true);
  expect(await fs.readFile(path.join(source, "bundle", "a.bin"))).toEqual(
    f.bytes,
  );
  await expect(
    fs.readFile(path.join(source, "bundle", "b.bin")),
  ).rejects.toThrow();
  const first = path.join(source, "bundle", "a.bin");
  await fs.utimes(first, new Date(1000000), new Date(1000000));
  const stamp = (await fs.stat(first)).mtimeMs;
  if (beforeSave) await beforeSave(f, task.id);
  let checkpoint!: TaskExecutionCheckpoint;
  await f.runtime.saveRecovery(f.human, task.id, async (c) => {
    checkpoint = readCheckpoint(JSON.parse(JSON.stringify(c)));
  });
  expect(checkpoint.resourceRecoveryRequired).toBe(false);
  expect(checkpoint.directoryState?.completedEntryIds).toHaveLength(2);
  const old = f.directoryTransfers.list(
    f.runtime.fileObservationContext(f.human, task.id),
  )[0];
  await f.directoryTransfers.release(
    f.runtime.fileObservationContext(f.human, task.id),
    old.id,
  );
  expect(
    f.directoryTransfers.list(
      f.runtime.fileObservationContext(f.human, task.id),
    ),
  ).toEqual([]);
  const restore = async () => {
    const next = await f.runtime.restoreRecovery(f.human, checkpoint, {
      sessionId: f.sessionId,
      requestId: randomUUID(),
    });
    f.runtime.enableRecovery(f.human, next.id);
    expect(f.runtime.state(f.human, next.id).state).toBe(
      "awaiting-authorization",
    );
    await expect(
      fs.readFile(path.join(source, "bundle", "b.bin")),
    ).rejects.toThrow();
    const bindings = await select(next.id);
    await authorize(next.id, bindings);
    return next;
  };
  return { ...f, task, source, checkpoint, restore, approve, stamp, first };
}
it.each(["automatic", "collaborative"] as const)(
  "restores an download directory checkpoint with fresh authorization in %s mode",
  async (mode) => {
    const f = await savedDownloadDirectory(mode),
      next = await f.restore();
    if (mode === "collaborative")
      for (let i = 0; i < 8; i++) {
        await vi.waitFor(
          () =>
            expect([
              "awaiting-approval",
              "completed",
              "paused-error",
            ]).toContain(f.runtime.state(f.human, next.id).state),
          { timeout: 10000 },
        );
        if (f.runtime.state(f.human, next.id).state === "completed") break;
        expect(f.runtime.state(f.human, next.id).error).toBeUndefined();
        await f.approve(next.id);
      }
    await vi.waitFor(
      () => {
        const state = f.runtime.state(f.human, next.id);
        expect(state.error).toBeUndefined();
        expect(state.state).toBe("completed");
      },
      { timeout: 15000 },
    );
    expect(await fs.readFile(path.join(f.source, "bundle", "b.bin"))).toEqual(
      Buffer.from("remaining"),
    );
    expect((await fs.stat(f.first)).mtimeMs).toBe(f.stamp);
    const operations = f.runtime.get(f.human, next.id).operations;
    expect(
      operations
        .filter((o) => o.action.type === "file.directory.entry")
        .map((o) => o.action.path),
    ).toEqual(["/srv/bundle/b.bin"]);
    expect(operations.at(-1)?.action.type).toBe("terminal.command");
    const inFlight = f.checkpoints.find((c) =>
      c.operations.some(
        (o) =>
          o.action.type === "file.directory.entry" && o.status === "unknown",
      ),
    );
    expect(inFlight?.resourceRecoveryRequired).toBe(true);
    expect(f.checkpoints.at(-1)?.completed).toBe(true);
  },
  30000,
);
it.each(["source", "completed-target"] as const)(
  "rejects a changed %s while restoring directory progress",
  async (changed) => {
    const f = await savedDownloadDirectory("automatic");
    if (changed === "source")
      await f.remote.write("/srv/bundle/b.bin", "changed source");
    else
      await fs.writeFile(
        path.join(f.source, "bundle", "a.bin"),
        "changed target",
      );
    const next = await f.restore();
    await vi.waitFor(
      () =>
        expect(f.runtime.state(f.human, next.id)).toMatchObject({
          state: "paused-error",
        }),
      { timeout: 15000 },
    );
    const state = f.runtime.get(f.human, next.id);
    expect(
      state.operations.some((o) => o.action.type === "file.directory.entry"),
    ).toBe(false);
    expect(
      state.operations.some((o) => o.action.type === "terminal.command"),
    ).toBe(false);
    await expect(
      fs.readFile(path.join(f.source, "bundle", "b.bin")),
    ).rejects.toThrow();
  },
  30000,
);
it("rejects a directory checkpoint attached to a different frozen step", async () => {
  const f = await savedDownloadDirectory("automatic"),
    bad = structuredClone(f.checkpoint);
  bad.directoryState!.stepId = "other";
  expect(() => readCheckpoint(bad)).toThrow("TASK_RECOVERY_INVALID");
}, 30000);

it("keeps a failed asynchronous snapshot paused and prevents early authorization", async () => {
  await savedDownloadDirectory("automatic", async (f, taskId) => {
    let begin!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        begin = resolve;
      }),
      blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
    const prepare = vi
      .spyOn(f.directoryTransfers, "prepareCheckpoint")
      .mockImplementationOnce(async () => {
        begin();
        await blocked;
        throw Error("DOWNLOAD_RESULT_UNVERIFIED");
      });
    const persist = vi.fn(async () => {}),
      saving = f.runtime.saveRecovery(f.human, taskId, persist);
    await started;
    try {
      await expect(
        f.runtime.authorize(f.human, taskId, {
          ...f.control.snapshot(),
          policyRevision: 1,
          shellReady: true,
          maxOperations: 20,
          durationMinutes: 10,
        }),
      ).rejects.toThrow("TASK_RECOVERY_BUSY");
    } finally {
      release();
    }
    await expect(saving).rejects.toThrow("DOWNLOAD_RESULT_UNVERIFIED");
    expect(persist).not.toHaveBeenCalled();
    expect(f.runtime.state(f.human, taskId)).toMatchObject({
      state: "paused-error",
      error: "TASK_RECOVERY_SAVING",
    });
    prepare.mockRestore();
  });
}, 30000);
