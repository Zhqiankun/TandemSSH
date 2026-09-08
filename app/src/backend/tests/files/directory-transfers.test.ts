import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import type {
  DirectoryAction,
  DirectoryChoice,
} from "../../../types/directory-transfer";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
type Fixture = Awaited<ReturnType<typeof transferToolsFixture>>;
async function setup(
  direction: "upload" | "download",
  mode: "automatic" | "collaborative" = "automatic",
) {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const local = path.join(
    f.folder,
    direction === "upload" ? "source-tree" : "target-tree",
  );
  await fs.mkdir(local);
  if (direction === "upload") {
    await fs.mkdir(path.join(local, "空目录"));
    await fs.writeFile(path.join(local, "bytes.bin"), f.bytes);
    await fs.writeFile(path.join(local, "empty.bin"), Buffer.alloc(0));
  } else {
    await f.remote.mkdir("/srv/source-tree");
    await f.remote.mkdir("/srv/source-tree/空目录");
    await f.remote.write("/srv/source-tree/bytes.bin", f.bytes);
    await f.remote.write("/srv/source-tree/empty.bin", Buffer.alloc(0));
  }
  const task = await f.runtime.create(f.actor, {
    sessionId: f.sessionId,
    requestId: randomUUID(),
    title: "目录传输",
    mode,
  });
  const ticket = f.grants.issue("owner", task.id, {
    windowToken: f.windowToken,
    direction,
    kind: "directory",
  });
  f.grants.claim(f.windowToken, ticket.id);
  const grant = (await f.grants.fulfill(f.windowToken, ticket.id, [local]))
    .grants[0];
  await f.authorize(task.id);
  const action: DirectoryAction = {
    type: "file.directory.preview",
    direction,
    path: direction === "upload" ? "/srv" : "/srv/source-tree",
    localGrantId: grant.id,
    localVersion: grant.version,
    overwrite: false,
  };
  return { ...f, local, task, grant, action };
}
async function dispatch(
  f: Fixture,
  taskId: string,
  action: DirectoryAction,
  mode: "automatic" | "collaborative" = "automatic",
) {
  const requestId = randomUUID();
  await f.runtime.submitFile(f.actor, taskId, action, requestId);
  let op = f.runtime
    .get(f.human, taskId)
    .operations.find((o) => o.requestId === requestId)!;
  if (mode === "collaborative") {
    await vi.waitFor(() =>
      expect(f.runtime.operation(f.human, taskId, op.id).status).toBe(
        "awaiting-approval",
      ),
    );
    expect(
      f.runtime.operation(f.human, taskId, op.id).fileResult,
    ).toBeUndefined();
    await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
  }
  await vi.waitFor(
    () =>
      expect([
        "succeeded",
        "failed",
        "unknown",
        "cancelled-before-send",
      ]).toContain(f.runtime.operation(f.human, taskId, op.id).status),
    { timeout: 10000 },
  );
  op = f.runtime.get(f.human, taskId).operations.find((o) => o.id === op.id)!;
  return op;
}
it.each([
  ["upload", "automatic"],
  ["upload", "collaborative"],
  ["download", "automatic"],
  ["download", "collaborative"],
] as const)(
  "%s directory %s uses real per-entry gateway operations and byte verification",
  async (direction, mode) => {
    const f = await setup(direction, mode),
      preview = await dispatch(f, f.task.id, f.action, mode);
    expect(preview.status, preview.error).toBe("succeeded");
    const id = preview.fileResult!.directoryTransfer!.previewId,
      ctx = f.runtime.fileObservationContext(f.actor, f.task.id),
      page = f.directoryTransfers.page(ctx, id);
    expect(page.entries).toBe(4);
    expect(JSON.stringify(page)).not.toContain(f.local);
    if (direction === "upload")
      await expect(
        f.remote.read("/srv/source-tree/bytes.bin"),
      ).rejects.toThrow();
    else expect(await fs.readdir(f.local)).toEqual([]);
    const choices = page.items.map((e) => ({
        id: e.id,
        action: "create" as DirectoryChoice,
      })),
      confirmation = await dispatch(
        f,
        f.task.id,
        f.directoryTransfers.confirmation(ctx, id, choices),
        mode,
      );
    expect(confirmation.status, confirmation.error).toBe("succeeded");
    for (const action of f.directoryTransfers.actions(ctx, id)) {
      const op = await dispatch(f, f.task.id, action, mode);
      expect(op.status, op.error).toBe("succeeded");
      expect(op.fileResult?.directoryTransfer?.entryId).toBe(action.entryId);
    }
    if (direction === "upload") {
      expect(await f.remote.read("/srv/source-tree/bytes.bin")).toEqual(
        f.bytes,
      );
      expect((await f.remote.io.stat("/srv/source-tree/空目录")).kind).toBe(
        "directory",
      );
    } else {
      expect(
        await fs.readFile(path.join(f.local, "source-tree", "bytes.bin")),
      ).toEqual(f.bytes);
      expect(
        await fs.readdir(path.join(f.local, "source-tree", "空目录")),
      ).toEqual([]);
    }
    expect(f.runtime.get(f.human, f.task.id).operations).toHaveLength(6);
    expect(f.writes).toEqual(["context"]);
    await f.directoryTransfers.release(ctx, id);
  },
);
it("rejects a preview from another task and a changed entry path", async () => {
  const f = await setup("upload"),
    op = await dispatch(f, f.task.id, f.action);
  expect(op.status, op.error).toBe("succeeded");
  const id = op.fileResult!.directoryTransfer!.previewId,
    ctx = f.runtime.fileObservationContext(f.actor, f.task.id),
    page = f.directoryTransfers.page(ctx, id);
  expect(() =>
    f.directoryTransfers.page({ ...ctx, taskId: randomUUID() }, id),
  ).toThrow("DIRECTORY_PREVIEW_NOT_FOUND");
  await dispatch(
    f,
    f.task.id,
    f.directoryTransfers.confirmation(
      ctx,
      id,
      page.items.map((e) => ({ id: e.id, action: "create" })),
    ),
  );
  const action = f.directoryTransfers.actions(ctx, id)[0];
  const denied = await dispatch(f, f.task.id, {
    ...action,
    path: "/srv/outside",
  });
  expect(denied.status).not.toBe("succeeded");
  await expect(f.remote.io.stat("/srv/outside")).rejects.toThrow();
});
it("denies a nested blacklisted path before remote writes", async () => {
  const f = await setup("upload");
  f.policy.sets.push({
    id: "deny",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [],
    fileRules: [
      {
        id: "private",
        effect: "deny",
        reason: "禁止访问",
        match: {
          kind: "path",
          path: "/srv/source-tree/bytes.bin",
          access: ["write"],
        },
      },
    ],
  });
  const preview = await dispatch(f, f.task.id, f.action);
  expect(preview.status, preview.error).toBe("succeeded");
  const ctx = f.runtime.fileObservationContext(f.actor, f.task.id),
    id = preview.fileResult!.directoryTransfer!.previewId,
    page = f.directoryTransfers.page(ctx, id);
  expect(page.items.find((e) => e.path.endsWith("/bytes.bin"))?.status).toBe(
    "blocked",
  );
  const denied = await dispatch(
    f,
    f.task.id,
    f.directoryTransfers.confirmation(
      ctx,
      id,
      page.items.map((e) => ({ id: e.id, action: "create" })),
    ),
  );
  expect(denied.status).not.toBe("succeeded");
  expect(f.remote.writes).toHaveLength(0);
});
