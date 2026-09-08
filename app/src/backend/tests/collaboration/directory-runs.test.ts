import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import type { DirectoryAction } from "../../../types/directory-transfer";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
async function fixture(mode: "automatic" | "collaborative") {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const folder = path.join(f.folder, "batch");
  await fs.mkdir(folder);
  await fs.mkdir(path.join(folder, "empty"));
  await fs.writeFile(path.join(folder, "file.bin"), f.bytes);
  const t = await f.runtime.create(f.actor, {
    sessionId: f.sessionId,
    requestId: randomUUID(),
    title: "directory",
    mode,
  });
  const ticket = f.grants.issue("owner", t.id, {
    windowToken: f.windowToken,
    kind: "directory",
    direction: "upload",
  });
  f.grants.claim(f.windowToken, ticket.id);
  const grant = (await f.grants.fulfill(f.windowToken, ticket.id, [folder]))
    .grants[0];
  await f.authorize(t.id);
  const action: Extract<DirectoryAction, { type: "file.directory.preview" }> = {
    type: "file.directory.preview",
    direction: "upload",
    path: "/srv",
    localGrantId: grant.id,
    localVersion: grant.version,
    overwrite: false,
  };
  const requestId = randomUUID(),
    submitted = await f.directoryAutomation.preview(
      f.actor,
      t.id,
      action,
      requestId,
    );
  const approve = async () => {
    await vi.waitFor(
      () =>
        expect(f.runtime.state(f.actor, t.id).state).toBe("awaiting-approval"),
      { timeout: 10000 },
    );
    const op = f.runtime.get(f.human, t.id).operations.at(-1)!;
    await f.runtime.approve(f.human, t.id, op.id, op.digest, 1);
    return op;
  };
  if (mode === "collaborative") await approve();
  await vi.waitFor(
    () =>
      expect(
        f.runtime.operation(f.actor, t.id, submitted.operationId).status,
      ).toBe("succeeded"),
    { timeout: 10000 },
  );
  const id = f.runtime.operation(f.actor, t.id, submitted.operationId)
      .fileResult!.directoryTransfer!.previewId,
    page = f.directoryAutomation.page(f.actor, t.id, id);
  return { ...f, task: t, previewId: id, page, approve };
}
it.each(["automatic", "collaborative"] as const)(
  "runs the complete %s batch under one parent task and reserves its command stream",
  async (mode) => {
    const f = await fixture(mode),
      requestId = randomUUID(),
      choices = f.page.items.map((e) => ({
        id: e.id,
        action: "create" as const,
      }));
    const run = f.directoryAutomation.run(
      f.actor,
      f.task.id,
      f.previewId,
      f.page.revision,
      choices,
      requestId,
    );
    expect(
      f.directoryAutomation.run(
        f.actor,
        f.task.id,
        f.previewId,
        f.page.revision,
        choices,
        requestId,
      ).id,
    ).toBe(run.id);
    await expect(
      f.runtime.submit(
        f.actor,
        f.task.id,
        { program: "pwd", args: [] },
        randomUUID(),
      ),
    ).rejects.toThrow("DIRECTORY_IN_PROGRESS");
    await expect(f.runtime.finish(f.actor, f.task.id)).rejects.toThrow(
      "TASK_NOT_COMPLETE",
    );
    if (mode === "collaborative")
      for (let i = 0; i < 4; i++) {
        const op = await f.approve();
        await vi.waitFor(
          () =>
            expect(f.runtime.operation(f.actor, f.task.id, op.id).status).toBe(
              "succeeded",
            ),
          { timeout: 10000 },
        );
      }
    await vi.waitFor(
      () =>
        expect(
          f.directoryAutomation.get(f.actor, f.task.id, run.id).state,
        ).toBe("completed"),
      { timeout: 10000 },
    );
    expect(await f.remote.read("/srv/batch/file.bin")).toEqual(f.bytes);
    expect(f.runtime.get(f.human, f.task.id).operations).toHaveLength(5);
    const cmd = await f.runtime.submit(
      f.actor,
      f.task.id,
      { program: "pwd", args: [] },
      randomUUID(),
    );
    expect(cmd.state).not.toBe("cancelled");
  },
);
it("pauses on manual takeover then resumes remaining entries without repeating a completed directory", async () => {
  const f = await fixture("collaborative"),
    run = f.directoryAutomation.run(
      f.actor,
      f.task.id,
      f.previewId,
      f.page.revision,
      f.page.items.map((e) => ({ id: e.id, action: "create" })),
      randomUUID(),
    );
  let op = await f.approve();
  await vi.waitFor(() =>
    expect(f.runtime.operation(f.actor, f.task.id, op.id).status).toBe(
      "succeeded",
    ),
  );
  op = await f.approve();
  await vi.waitFor(() =>
    expect(f.runtime.operation(f.actor, f.task.id, op.id).status).toBe(
      "succeeded",
    ),
  );
  f.runtime.takeover(f.human, f.sessionId);
  await vi.waitFor(() =>
    expect(f.directoryAutomation.get(f.human, f.task.id, run.id).state).toBe(
      "paused-human",
    ),
  );
  expect(await f.remote.io.stat("/srv/batch")).toBeTruthy();
  await f.authorize(f.task.id);
  for (let i = 0; i < 2; i++) {
    const next = await f.approve();
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.actor, f.task.id, next.id).status).toBe(
        "succeeded",
      ),
    );
  }
  await vi.waitFor(() =>
    expect(f.directoryAutomation.get(f.actor, f.task.id, run.id).state).toBe(
      "completed",
    ),
  );
  expect(
    f.runtime
      .get(f.human, f.task.id)
      .operations.filter(
        (o) =>
          o.action.type === "file.directory.entry" &&
          o.action.path === "/srv/batch" &&
          o.status === "succeeded",
      ),
  ).toHaveLength(1);
});
