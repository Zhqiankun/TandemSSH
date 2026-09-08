import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import { releaseTaskFileResources } from "../../collaboration/files/task-resources";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanup.splice(0).reverse()) await c();
});
it("archives actual transfers and frees native grants without deleting final files", async () => {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const task = await f.runtime.create(f.actor, {
    sessionId: f.sessionId,
    title: "transfer history",
    mode: "automatic",
    requestId: randomUUID(),
  });
  const grants = await f.select(task.id);
  await f.authorize(task.id);
  for (const direction of ["upload", "download"] as const) {
    const grant = grants.find((g) => g.direction === direction)!;
    const op = await f.automation.submit(
      f.actor,
      task.id,
      {
        path: "/srv/archive.bin",
        localGrantId: grant.id,
        localVersion: grant.version,
      },
      randomUUID(),
      direction,
    );
    await vi.waitFor(
      () =>
        expect(
          f.runtime.operation(f.actor, task.id, op.operationId).status,
        ).toBe("succeeded"),
      { timeout: 10000 },
    );
  }
  await f.runtime.finish(f.actor, task.id);
  const documents = { forgetTask: vi.fn() };
  await f.runtime.archive(f.human, task.id, () =>
    releaseTaskFileResources(
      {
        context: (userId, id) =>
          f.runtime.fileObservationContext({ kind: "human", userId }, id),
        directories: f.directoryAutomation,
        directoryTransfers: f.directoryTransfers,
        transfers: f.transfers,
        documents,
        local: f.grants,
      },
      "owner",
      task.id,
    ),
  );
  expect(f.grants.humanList("owner", task.id)).toEqual([]);
  expect(await fs.readFile(f.destination)).toEqual(f.bytes);
  expect(await f.remote.read("/srv/archive.bin")).toEqual(f.bytes);
  expect(documents.forgetTask).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "owner", taskId: task.id }),
  );
});
it("reclaims expired unassigned previews and preserves a retained workflow preview", async () => {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const task = await f.runtime.create(f.actor, {
      sessionId: f.sessionId,
      title: "preview retention",
      mode: "automatic",
      requestId: randomUUID(),
    }),
    source = path.join(f.folder, "folder");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "data"), f.bytes);
  const ticket = f.grants.issue("owner", task.id, {
    windowToken: f.windowToken,
    kind: "directory",
    direction: "upload",
  });
  f.grants.claim(f.windowToken, ticket.id);
  const grant = (await f.grants.fulfill(f.windowToken, ticket.id, [source]))
    .grants[0];
  await f.authorize(task.id);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const op = await f.directoryAutomation.preview(
      f.actor,
      task.id,
      {
        type: "file.directory.preview",
        direction: "upload",
        path: "/srv",
        localGrantId: grant.id,
        localVersion: grant.version,
        overwrite: false,
      },
      randomUUID(),
    );
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.actor, task.id, op.operationId).status).toBe(
        "succeeded",
      ),
    );
    ids.push(
      f.runtime.operation(f.actor, task.id, op.operationId).fileResult!
        .directoryTransfer!.previewId,
    );
  }
  const context = f.runtime.fileObservationContext(f.human, task.id),
    release = f.directoryTransfers.retain(context, ids[1]),
    expires = f.directoryTransfers.summary(context, ids[0]).expiresAt;
  vi.spyOn(Date, "now").mockReturnValue(expires + 1);
  expect(await f.directoryTransfers.pruneExpired()).toBe(1);
  expect(f.directoryTransfers.list(context).map((p) => p.id)).toEqual([ids[1]]);
  release();
});
