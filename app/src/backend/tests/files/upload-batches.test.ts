import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { UploadService, type UploadPorts } from "../../files/upload-service";
import { UploadTreeService } from "../../files/upload-tree-service";
import { FilePathLocks } from "../../files/path-locks";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import type {
  DesktopUploadSourceApi,
  NativeUploadSelection,
} from "../../../types/upload-source";
import type {
  UploadTreeMapping,
  UploadTreeAction,
} from "../../../types/upload-tree";
import type { DownloadNativeResult } from "../../../types/file-download";
import type { UploadApiPort } from "../../../ui/api/file-upload-api";
import type { UploadTreeApi } from "../../../ui/api/upload-tree-api";
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { UploadQueue } from "../../../ui/features/file-manager/uploads/queue";
import { UploadBatches } from "../../../ui/features/file-manager/uploads/upload-batches";
const require = createRequire(import.meta.url);
const {
  UploadSourceStore,
} = require("../../../../electron/upload-sources.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  await remote.mkdir("/dest");
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    local = await fs.mkdtemp(path.join(cache, "upload-batch-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(local);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("upload-batch-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const root = path.join(local, "应用");
  await fs.mkdir(path.join(root, "空目录"), { recursive: true });
  await fs.writeFile(
    path.join(root, "结果 %.txt"),
    Buffer.from([0, 255, 2, 10]),
  );
  await fs.writeFile(path.join(root, "zero"), "");
  let automation = false,
    takeovers = 0;
  const ports: UploadPorts = {
    locks: new FilePathLocks(),
    audit: vi.fn(async () => {}),
    target: async () => ({
      key: "fixture",
      connection: "session",
      acceptedHostKey: remote.peerKey(),
      io: remote.io,
      check: () => {},
    }),
    beginWrite: (_u, _t, takeover) => {
      if (automation && !takeover) throw Error("FILE_AUTOMATION_ACTIVE");
      if (automation) {
        automation = false;
        takeovers++;
      }
      return () => {};
    },
  };
  const uploads = new UploadService(ports),
    trees = new UploadTreeService(ports, uploads),
    store = new UploadSourceStore(),
    actor = { userId: "owner" };
  cleanup.push(
    () => uploads.dispose(),
    () => trees.dispose(),
    () => store.reset(1),
  );
  async function result<T>(
    work: () => T | Promise<T>,
  ): Promise<DownloadNativeResult<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "UPLOAD_FAILED",
      };
    }
  }
  const native: DesktopUploadSourceApi = {
    chooseDirectory: () => result(() => store.select(1, [root])),
    fromFiles: vi.fn(),
    check: (id, e) => result(() => store.check(1, id, e)),
    chunk: (id, e, o, n) => result(() => store.chunk(1, id, e, o, n)),
    forget: vi.fn((id) => result(() => store.forget(1, id))),
    reset: async () => ({ ok: true, value: null }),
  };
  const api: UploadTreeApi = {
    preview: (p, signal) => trees.preview({ ...actor, signal }, p),
    get: async (_s, id) => trees.get(actor, id),
    touch: async (_s, id) => trees.touch(actor, id),
    confirm: (_s, id, revision, decisions) =>
      trees.confirm(actor, id, revision, decisions),
    directories: vi.fn((_s, id, takeover, signal) =>
      trees.directories({ ...actor, signal }, id, takeover),
    ),
    prepare: (session, id, entry, request, manifest, signal) =>
      trees.prepareEntry(
        { ...actor, signal },
        id,
        entry,
        session,
        request,
        manifest,
      ),
    cancel: async (_s, id) => trees.cancel(actor, id),
    forget: vi.fn(async (_s, id) => trees.forget(actor, id)),
  };
  const files: UploadApiPort = {
    prepare: (p, signal) => uploads.prepare({ ...actor, signal }, p),
    start: (_s, id, p, signal) => uploads.start({ ...actor, signal }, id, p),
    chunk: async (_s, id, offset, blob, signal) =>
      uploads.chunk(
        { ...actor, signal },
        id,
        offset,
        Buffer.from(await blob.arrayBuffer()),
      ),
    action: async (session, id, action, input, signal) => {
      const a = { ...actor, signal };
      if (action === "resume")
        return uploads.resume(a, id, session, input?.takeover === true);
      if (action === "cancel")
        return uploads.cancel(a, id, input?.cleanup === true);
      if (action === "forget") {
        const view = uploads.get(a, id);
        uploads.forget(a, id);
        return view;
      }
      return uploads[action](a, id);
    },
  };
  const queue = new UploadQueue(files),
    batches = new UploadBatches(queue, api, () => native);
  queue.setOwner("owner");
  batches.setOwner("owner");
  cleanup.push(() => {
    batches.setOwner(null);
    queue.resetForSignOut();
  });
  const source: NativeUploadSelection = await store.select(1, [root]);
  const preview = () =>
    api.preview({
      sessionId: "session",
      path: "/dest",
      entries: source.entries.map((e) => ({
        id: e.id,
        parentId: e.parentId,
        name: e.name,
        kind: e.kind as UploadTreeMapping["kind"],
        size: e.size,
        lastModified: e.lastModified,
      })),
    });
  const start = async (takeover = false, skip = false) => {
    const target = await preview();
    return {
      target,
      id: await batches.start({
        source,
        target,
        hostLabel: "fixture",
        takeover,
        decisions: target.entries.map((e) => ({
          id: e.id,
          action: (skip
            ? "skip"
            : e.status === "new"
              ? "create"
              : e.status === "directory"
                ? "merge"
                : "overwrite") as UploadTreeAction,
        })),
      }),
    };
  };
  const settle = () =>
    vi.waitFor(() => expect(batches.getSnapshot()[0]?.state).toBe("finished"), {
      timeout: 20000,
    });
  return {
    remote,
    local,
    root,
    ports,
    uploads,
    trees,
    source,
    native,
    api,
    files,
    queue,
    batches,
    start,
    preview,
    settle,
    automation: () => {
      automation = true;
    },
    takeovers: () => takeovers,
  };
}
describe("reviewed upload batches over native source and real SFTP", () => {
  it("uploads binary bytes and empty directories through the shared queue, then releases all records", async () => {
    const f = await fixture();
    const target = await f.preview();
    expect(
      await f.remote.read("/dest/应用/结果 %.txt").catch(() => null),
    ).toBeNull();
    await f.api.forget("session", target.id);
    const b = await f.start();
    await f.settle();
    expect(
      f.batches.getSnapshot()[0],
      JSON.stringify(f.queue.getSnapshot()),
    ).toMatchObject({ completed: 4, failed: 0, unknown: 0, total: 4 });
    expect(await f.remote.read("/dest/应用/结果 %.txt")).toEqual(
      Buffer.from([0, 255, 2, 10]),
    );
    expect((await f.remote.io.stat("/dest/应用/空目录", () => {}))?.kind).toBe(
      "directory",
    );
    expect(await f.remote.read("/dest/应用/zero")).toHaveLength(0);
    expect(
      f.queue
        .getSnapshot()
        .filter((j) => j.kind === "file")
        .every((j) => j.transfer?.verification === "sha256"),
    ).toBe(true);
    await f.queue.removeFinished();
    expect(f.queue.getSnapshot()).toEqual([]);
    expect(f.batches.getSnapshot()).toEqual([]);
    expect(() => f.trees.get({ userId: "owner" }, b.target.id)).toThrow(
      "UPLOAD_NOT_FOUND",
    );
    expect(f.native.forget).toHaveBeenCalledWith(f.source.id);
  }, 30000);
  it("requires takeover before remote mkdir and supports an explicit directory retry", async () => {
    const f = await fixture();
    f.automation();
    await f.start();
    await f.settle();
    expect(f.takeovers()).toBe(0);
    expect(
      f.queue.getSnapshot().some((j) => j.error === "FILE_AUTOMATION_ACTIVE"),
    ).toBe(true);
    const dir = f.queue.getSnapshot().find((j) => j.kind === "directory")!;
    await f.queue.repreview(dir.id, undefined, undefined, true);
    expect(f.takeovers()).toBe(1);
    for (const job of f.queue.getSnapshot())
      if (job.kind === "file" && job.state === "failed")
        await f.queue.repreview(job.id);
    await vi.waitFor(
      () => expect(f.batches.getSnapshot()[0].completed).toBe(4),
      { timeout: 20000 },
    );
  }, 30000);
  it("skips an entire batch without taking over or reading file chunks", async () => {
    const f = await fixture();
    f.automation();
    const chunk = vi.spyOn(f.native, "chunk");
    await f.start(true, true);
    await f.settle();
    expect(f.takeovers()).toBe(0);
    expect(chunk).not.toHaveBeenCalled();
    expect(f.batches.getSnapshot()[0]).toMatchObject({
      completed: 0,
      skipped: 4,
    });
    await f.queue.removeFinished();
    expect(f.batches.getSnapshot()).toEqual([]);
  }, 30000);
  it("retains failed source changes and never sends their content", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, "结果 %.txt"), "changed");
    await f.start();
    await f.settle();
    expect(f.batches.getSnapshot()[0].failed).toBe(1);
    expect(
      await f.remote.read("/dest/应用/结果 %.txt").catch(() => null),
    ).toBeNull();
  }, 30000);
  it("keeps ambiguous directory results after cancel and clear, without retrying mkdir", async () => {
    const f = await fixture();
    vi.mocked(f.api.directories).mockRejectedValue(Error("transport lost"));
    const b = await f.start();
    await f.settle();
    expect(f.batches.getSnapshot()[0].unknown).toBe(2);
    await f.batches.cancel(b.id);
    await f.queue.removeFinished();
    expect(
      f.queue.getSnapshot().filter((j) => j.state === "unknown"),
    ).toHaveLength(2);
    expect(f.api.directories).toHaveBeenCalledTimes(1);
    expect(f.native.forget).not.toHaveBeenCalled();
  }, 30000);
  it("invalidates admission when the owner changes while confirmation is in flight", async () => {
    const f = await fixture(),
      target = await f.preview();
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const original = f.api.confirm;
    vi.spyOn(f.api, "confirm").mockImplementation(async (...args) => {
      await wait;
      return original(...args);
    });
    const work = f.batches.start({
      source: f.source,
      target,
      hostLabel: "fixture",
      takeover: true,
      decisions: target.entries.map((e) => ({ id: e.id, action: "create" })),
    });
    f.queue.setOwner("other");
    f.batches.setOwner("other");
    release();
    await expect(work).rejects.toThrow("UPLOAD_CANCELLED");
    expect(f.queue.getSnapshot()).toEqual([]);
    expect(f.api.directories).not.toHaveBeenCalled();
  }, 30000);
});
