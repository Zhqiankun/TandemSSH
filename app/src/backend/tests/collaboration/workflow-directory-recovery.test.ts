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
async function savedDirectory(mode: "automatic" | "collaborative") {
  const f = await transferToolsFixture();
  cleanups.push(f.close);
  const source = path.join(f.folder, "bundle");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "a.bin"), f.bytes);
  await fs.writeFile(path.join(source, "b.bin"), Buffer.from("remaining"));
  const saved = await f.workflows.save("owner", {
    allowedHostIds: [7],
    definition: {
      schemaVersion: 3,
      id: "recover-directory",
      name: "恢复目录上传",
      version: "1.0.0",
      parameters: {},
      files: { artifact: { direction: "upload", kind: "directory" } },
      defaults: { cwd: "/srv" },
      steps: [
        {
          id: "up",
          name: "上传目录",
          action: {
            type: "upload-directory",
            path: "/srv",
            localFile: "artifact",
          },
        },
        {
          id: "after",
          name: "上传后继续",
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
      direction: "upload",
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
  expect(await f.remote.read("/srv/bundle/a.bin")).toEqual(f.bytes);
  await expect(f.remote.read("/srv/bundle/b.bin")).rejects.toThrow();
  const first = f.remote.localPathForTest("/srv/bundle/a.bin");
  await fs.utimes(first, new Date(1000000), new Date(1000000));
  const stamp = (await fs.stat(first)).mtimeMs;
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
    await expect(f.remote.read("/srv/bundle/b.bin")).rejects.toThrow();
    const bindings = await select(next.id);
    await authorize(next.id, bindings);
    return next;
  };
  return { ...f, task, source, checkpoint, restore, approve, stamp, first };
}
it.each(["automatic", "collaborative"] as const)(
  "restores an upload directory checkpoint with fresh authorization in %s mode",
  async (mode) => {
    const f = await savedDirectory(mode),
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
    expect(await f.remote.read("/srv/bundle/b.bin")).toEqual(
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
    const f = await savedDirectory("automatic");
    if (changed === "source")
      await fs.writeFile(path.join(f.source, "b.bin"), "changed source");
    else await f.remote.write("/srv/bundle/a.bin", "changed target");
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
    await expect(f.remote.read("/srv/bundle/b.bin")).rejects.toThrow();
  },
  30000,
);
it("rejects a directory checkpoint attached to a different frozen step", async () => {
  const f = await savedDirectory("automatic"),
    bad = structuredClone(f.checkpoint);
  bad.directoryState!.stepId = "other";
  expect(() => readCheckpoint(bad)).toThrow("TASK_RECOVERY_INVALID");
}, 30000);
