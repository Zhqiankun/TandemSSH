import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  DesktopDownloadApi,
  DownloadNativeResult,
} from "@/types/file-download";
import type { DesktopDownloadDirectoryApi } from "@/types/download-tree";
import type { DownloadApiPort } from "@/api/file-download-api";
import type { DownloadTreeApi } from "@/api/download-tree-api";
import { fileSftpFixture } from "../../../../../backend/test-helpers/file-sftp-fixture";
import {
  DownloadService,
  type DownloadPorts,
} from "../../../../../backend/files/download-service";
import { DownloadTreeService } from "../../../../../backend/files/download-tree-service";
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { DownloadQueue } from "../../../../features/file-manager/downloads/queue";
import { DownloadBatches } from "../../../../features/file-manager/downloads/download-batches";
const require = createRequire(import.meta.url);
const {
  DownloadSink,
} = require("../../../../../../electron/download-sink.cjs");
const {
  DownloadDirectoryTargets,
} = require("../../../../../../electron/download-directory-targets.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "batch-download-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("batch-download-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const ports: DownloadPorts = {
    audit: vi.fn(async () => {}),
    target: async () => ({
      io: remote.io,
      key: "fixture",
      connection: "session",
      acceptedHostKey: remote.peerKey(),
      check: () => {},
    }),
  };
  const downloads = new DownloadService(ports),
    trees = new DownloadTreeService(ports, downloads),
    sink = new DownloadSink(),
    targets = new DownloadDirectoryTargets(sink);
  cleanup.push(
    () => downloads.dispose(),
    () => trees.dispose(),
    () => sink.reset(1),
    () => targets.reset(1),
  );
  const actor = { userId: "owner" };
  async function result<T>(
    work: () => T | Promise<T>,
  ): Promise<DownloadNativeResult<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "DOWNLOAD_FAILED",
      };
    }
  }
  const native: DesktopDownloadApi = {
    reset: vi.fn(async () => ({ ok: true as const, value: null })),
    choose: vi.fn(() => {
      throw Error("Unexpected per-file dialog");
    }),
    start: (id, overwrite) => result(() => sink.start(1, id, overwrite)),
    append: (id, offset, bytes) =>
      result(() => sink.append(1, id, offset, bytes)),
    action: (id, action) =>
      result(() =>
        action === "show" ? sink.view(sink.owned(1, id)) : sink[action](1, id),
      ),
  };
  const directories: DesktopDownloadDirectoryApi = {
    choose: () => result(() => targets.choose(1, async () => folder)),
    preview: (id, entries) => result(() => targets.preview(1, id, entries)),
    confirm: (id, revision, decisions) =>
      result(() => targets.confirm(1, id, revision, decisions)),
    directories: (id) => result(() => targets.directories(1, id)),
    file: (id, entry, spec) => result(() => targets.file(1, id, entry, spec)),
    complete: (id, entry) => result(() => targets.complete(1, id, entry)),
    show: (id, entry) =>
      result(() => {
        targets.show(1, id, entry);
        return null;
      }),
    cancel: (id) => result(() => targets.cancel(1, id)),
    forget: (id) => result(() => targets.forget(1, id)),
  };
  const api: DownloadTreeApi = {
    scan: (input, signal) => trees.scan({ ...actor, signal }, input),
    touch: async (_session, id, signal) =>
      trees.touch({ ...actor, signal }, id),
    forget: async (_session, id) => trees.forget(actor, id),
    prepare: (session, id, entry, requestId, signal) =>
      trees.prepareEntry({ ...actor, signal }, id, entry, requestId, session),
  };
  const files: DownloadApiPort = {
    prepare: (input, signal) => downloads.prepare({ ...actor, signal }, input),
    chunk: async (_session, id, offset, signal) =>
      new Uint8Array(await downloads.chunk({ ...actor, signal }, id, offset)),
    action: async (session, id, action, signal) =>
      action === "resume"
        ? downloads.verify({ ...actor, signal }, id, session)
        : downloads[action]({ ...actor, signal }, id),
  };
  const queue = new DownloadQueue(files, () => native),
    batches = new DownloadBatches(queue, api, files, () => directories);
  queue.setOwner("owner");
  batches.setOwner("owner");
  cleanup.push(() => {
    batches.setOwner(null);
    queue.setOwner(null);
  });
  async function preview() {
    const source = await api.scan(
      { sessionId: "session", paths: ["/tree"] },
      new AbortController().signal,
    );
    const selected = await directories.choose();
    if (!selected.ok || !selected.value) throw Error("choose");
    const target = await directories.preview(
      selected.value.id,
      source.entries
        .filter(
          (e) => !e.error && (e.kind === "file" || e.kind === "directory"),
        )
        .map((e) => ({
          id: e.id,
          parentId: e.parentId,
          name: e.name,
          kind: e.kind as "file" | "directory",
          size: e.kind === "directory" ? 0 : e.size,
        })),
    );
    if (target.ok === false) throw Error(target.error);
    return { source, target: target.value };
  }
  return {
    remote,
    folder,
    queue,
    batches,
    api,
    files,
    native,
    directories,
    preview,
    trees,
    sink,
  };
}
describe("directory batch through the shared queue and real SFTP/filesystem", () => {
  it("downloads all files, preserves empty directories and releases previews after clearing", async () => {
    const f = await fixture();
    await f.remote.mkdir("/tree/empty");
    await f.remote.mkdir("/tree/sub");
    await f.remote.write("/tree/sub/中文 %.txt", "hello");
    await f.remote.write("/tree/zero", "");
    const p = await f.preview();
    expect(await fs.readdir(f.folder)).toEqual([]);
    await f.batches.start({
      ...p,
      hostLabel: "fixture",
      decisions: p.target.entries.map((e) => ({ id: e.id, action: "create" })),
    });
    await vi.waitFor(
      () =>
        expect(
          f.queue.getSnapshot().every((j) => j.state === "completed"),
        ).toBe(true),
      { timeout: 10000 },
    );
    expect(f.queue.getSnapshot()).toHaveLength(5);
    expect(
      await fs.readFile(path.join(f.folder, "tree/sub/中文 %.txt"), "utf8"),
    ).toBe("hello");
    expect(await fs.readdir(path.join(f.folder, "tree/empty"))).toEqual([]);
    expect((await fs.stat(path.join(f.folder, "tree/zero"))).size).toBe(0);
    expect(f.native.choose).not.toHaveBeenCalled();
    await f.queue.clearFinished();
    expect(f.queue.getSnapshot()).toEqual([]);
    expect(f.batches.getSnapshot()).toEqual([]);
    expect(() => f.trees.get({ userId: "owner" }, p.source.id)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
  }, 15000);
  it("skips an existing subtree explicitly and transfers a sibling without modifying its files", async () => {
    const f = await fixture();
    await f.remote.mkdir("/tree/skip");
    await f.remote.write("/tree/skip/file", "new");
    await f.remote.write("/tree/keep", "copied");
    await fs.mkdir(path.join(f.folder, "tree/skip"), { recursive: true });
    await fs.writeFile(path.join(f.folder, "tree/skip/file"), "original");
    const p = await f.preview(),
      root = p.target.entries.find((e) => !e.parentId)!,
      skipped = p.target.entries.find((e) => e.name === "skip")!;
    await f.batches.start({
      ...p,
      hostLabel: "fixture",
      decisions: p.target.entries.map((e) => ({
        id: e.id,
        action:
          e.id === root.id
            ? "merge"
            : e.id === skipped.id
              ? "skip"
              : e.status === "new"
                ? "create"
                : "overwrite",
      })),
    });
    await vi.waitFor(
      () => expect(f.batches.getSnapshot()[0].state).toBe("finished"),
      { timeout: 10000 },
    );
    expect(
      await fs.readFile(path.join(f.folder, "tree/skip/file"), "utf8"),
    ).toBe("original");
    expect(await fs.readFile(path.join(f.folder, "tree/keep"), "utf8")).toBe(
      "copied",
    );
    expect(
      f.queue.getSnapshot().filter((j) => j.state === "skipped"),
    ).toHaveLength(2);
    await f.queue.clearFinished();
    expect(f.batches.getSnapshot()).toEqual([]);
  }, 15000);
  it("pauses at a block boundary, keeps checkpoints alive, and resumes through the same worker", async () => {
    const f = await fixture();
    await f.remote.mkdir("/tree");
    const bytes = Buffer.alloc(4194304 + 19, 97);
    await f.remote.write("/tree/big", bytes);
    const p = await f.preview();
    let unblock!: () => void;
    const gate = new Promise<void>((r) => {
      unblock = r;
    });
    let waiting = false;
    const chunk = f.files.chunk;
    vi.spyOn(f.files, "chunk").mockImplementation(
      async (...args: Parameters<DownloadApiPort["chunk"]>) => {
        if (args[2] > 0) {
          waiting = true;
          await gate;
        }
        return chunk(...args);
      },
    );
    await f.batches.start({
      ...p,
      hostLabel: "fixture",
      decisions: p.target.entries.map((e) => ({ id: e.id, action: "create" })),
    });
    await vi.waitFor(() => expect(waiting).toBe(true), { timeout: 10000 });
    const job = f.queue.getSnapshot().find((j) => j.kind === "file")!;
    f.queue.pause(job.id);
    unblock();
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot().find((j) => j.id === job.id)?.state).toBe(
        "paused",
      ),
    );
    const now = Date.now(),
      clock = vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 1000);
    try {
      await f.batches.maintain();
      clock.mockReturnValue(now + 50 * 60 * 1000);
      await f.batches.maintain();
      await f.sink.prune();
      f.queue.resume(job.id);
      await vi.waitFor(
        () =>
          expect(
            f.queue.getSnapshot().find((j) => j.id === job.id)?.state,
          ).toBe("completed"),
        { timeout: 10000 },
      );
    } finally {
      clock.mockRestore();
    }
    expect(
      (await fs.readFile(path.join(f.folder, "tree/big"))).equals(bytes),
    ).toBe(true);
    await f.queue.clearFinished();
  }, 20000);
  it("cancels queued siblings and cleans an active partial file without writing the remaining source", async () => {
    const f = await fixture();
    await f.remote.mkdir("/tree");
    await f.remote.write("/tree/a", "first");
    await f.remote.write("/tree/b", "second");
    f.queue.setConcurrency(1);
    const p = await f.preview();
    let unblock!: () => void;
    const gate = new Promise<void>((r) => {
      unblock = r;
    });
    let waiting = false;
    const chunk = f.files.chunk;
    vi.spyOn(f.files, "chunk").mockImplementation(
      async (...args: Parameters<DownloadApiPort["chunk"]>) => {
        waiting = true;
        await gate;
        return chunk(...args);
      },
    );
    const id = await f.batches.start({
      ...p,
      hostLabel: "fixture",
      decisions: p.target.entries.map((e) => ({ id: e.id, action: "create" })),
    });
    await vi.waitFor(() => expect(waiting).toBe(true), { timeout: 10000 });
    await f.batches.cancel(id);
    unblock();
    await vi.waitFor(() =>
      expect(
        f.queue
          .getSnapshot()
          .filter((j) => j.kind === "file")
          .every((j) => j.state === "cancelled" && !j.local?.temporaryPath),
      ).toBe(true),
    );
    expect(await fs.readdir(path.join(f.folder, "tree"))).toEqual([]);
    await f.queue.clearFinished();
    expect(f.batches.getSnapshot()).toEqual([]);
  }, 15000);
  it("retains changed-source failures without retrying already completed items", async () => {
    const f = await fixture();
    await f.remote.mkdir("/tree");
    await f.remote.write("/tree/good", "good");
    await f.remote.write("/tree/changed", "before");
    const p = await f.preview();
    await f.remote.write("/tree/changed", "different size");
    await f.batches.start({
      ...p,
      hostLabel: "fixture",
      decisions: p.target.entries.map((e) => ({ id: e.id, action: "create" })),
    });
    await vi.waitFor(
      () => expect(f.batches.getSnapshot()[0].state).toBe("finished"),
      { timeout: 10000 },
    );
    expect(
      f.queue.getSnapshot().find((j) => j.name.endsWith("changed")),
    ).toMatchObject({ state: "failed", error: "DOWNLOAD_SOURCE_CHANGED" });
    const good = f.queue.getSnapshot().find((j) => j.name.endsWith("good"))!;
    await f.queue.retry(good.id);
    expect(await fs.readFile(path.join(f.folder, "tree/good"), "utf8")).toBe(
      "good",
    );
    await expect(
      fs.stat(path.join(f.folder, "tree/changed")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 15000);
});
