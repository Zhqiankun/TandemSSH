import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DownloadSink } = require("../electron/download-sink.cjs");
const {
  DownloadDirectoryTargets,
} = require("../electron/download-directory-targets.cjs");
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const spec = (bytes: Buffer) => ({
  name: "remote.bin",
  size: bytes.length,
  sha256: digest(bytes),
  hashes: bytes.length ? [digest(bytes)] : [],
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache"));
  const directory = await fs.mkdtemp(path.join(cache, "native-tree-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(directory);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("native-tree-")
    )
      throw Error("Fixture cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const selected = path.join(directory, "selected"),
    outside = path.join(directory, "outside");
  await fs.mkdir(selected);
  await fs.mkdir(outside);
  const sink = new DownloadSink(),
    targets = new DownloadDirectoryTargets(sink);
  cleanup.push(
    () => sink.reset(1),
    () => targets.reset(1),
  );
  const root = await targets.choose(1, async () => selected);
  return { selected, outside, directory, sink, targets, root };
}
const mapping = [
  { id: "folder", name: "项目", kind: "directory", size: 0 },
  {
    id: "empty",
    parentId: "folder",
    name: "空目录",
    kind: "directory",
    size: 0,
  },
  { id: "file", parentId: "folder", name: "结果 %.bin", kind: "file", size: 4 },
];
describe("native directory download targets", () => {

  it("remaps descendants on parent rename and refuses the previous revision before writing", async () => {
    const f = await fixture();
    const oldDirectory = path.join(f.selected, "项目");
    await fs.mkdir(oldDirectory);
    await fs.writeFile(path.join(oldDirectory, "结果 %.bin"), "keep original");
    const old = await f.targets.preview(1, f.root.id, mapping);
    const next = await f.targets.preview(1, f.root.id, mapping.map((e) =>
      e.id === "folder" ? { ...e, name: "改名后的项目" } : e,
    ));
    const decisions = mapping.map((e) => ({ id: e.id, action: "create" }));
    expect(next.revision).not.toBe(old.revision);
    expect(() => f.targets.confirm(1, f.root.id, old.revision, decisions)).toThrow("DOWNLOAD_NOT_READY");
    await expect(f.targets.directories(1, f.root.id)).rejects.toThrow("DOWNLOAD_NOT_READY");
    expect(await fs.readdir(f.selected)).toEqual(["项目"]);
    f.targets.confirm(1, f.root.id, next.revision, decisions);
    await f.targets.directories(1, f.root.id);
    const bytes = Buffer.from([0, 2, 143, 255]);
    const file = await f.targets.file(1, f.root.id, "file", spec(bytes));
    await f.sink.start(1, file.id, false);
    await f.sink.append(1, file.id, 0, bytes);
    await f.sink.finish(1, file.id);
    f.targets.complete(1, f.root.id, "file");
    expect(await fs.readFile(path.join(f.selected, "改名后的项目", "结果 %.bin"))).toEqual(bytes);
    expect(await fs.readdir(path.join(f.selected, "改名后的项目", "空目录"))).toEqual([]);
    expect(await fs.readFile(path.join(oldDirectory, "结果 %.bin"), "utf8")).toBe("keep original");
    expect(await fs.readdir(oldDirectory)).toEqual(["结果 %.bin"]);
  });

  it("does not write before confirmation, creates empty directories and preserves actual downloaded bytes after clearing", async () => {
    const f = await fixture(),
      bytes = Buffer.from([0, 2, 143, 255]);
    const preview = await f.targets.preview(1, f.root.id, mapping);
    expect(await fs.readdir(f.selected)).toEqual([]);
    await expect(f.targets.directories(1, f.root.id)).rejects.toThrow(
      "DOWNLOAD_NOT_READY",
    );
    f.targets.confirm(
      1,
      f.root.id,
      preview.revision,
      preview.entries.map((e: { id: string }) => ({
        id: e.id,
        action: "create",
      })),
    );
    const directories = await f.targets.directories(1, f.root.id);
    expect(directories.map((e: { state: string }) => e.state)).toEqual([
      "created",
      "created",
    ]);
    const file = await f.targets.file(1, f.root.id, "file", spec(bytes));
    await f.sink.start(1, file.id, false);
    await f.sink.append(1, file.id, 0, bytes);
    await f.sink.finish(1, file.id);
    const finished = f.targets.complete(1, f.root.id, "file");
    expect(finished.sha256).toBe(digest(bytes));
    expect(() => f.sink.owned(1, file.id)).toThrow("DOWNLOAD_NOT_FOUND");
    expect(
      (await fs.readFile(f.targets.show(1, f.root.id, "file"))).equals(bytes),
    ).toBe(true);
    f.targets.forget(1, f.root.id);
    expect(
      (await fs.readFile(path.join(f.selected, "项目", "结果 %.bin"))).equals(
        bytes,
      ),
    ).toBe(true);
    expect(await fs.readdir(path.join(f.selected, "项目", "空目录"))).toEqual(
      [],
    );
  });
  it("requires explicit overwrite and refuses a destination changed after preview", async () => {
    const f = await fixture(),
      file = path.join(f.selected, "file.bin");
    await fs.writeFile(file, "old");
    const preview = await f.targets.preview(1, f.root.id, [
      { id: "file", name: "file.bin", kind: "file", size: 4 },
    ]);
    expect(preview.entries[0]).toMatchObject({
      status: "conflict",
      existing: { size: 3 },
    });
    expect(() =>
      f.targets.confirm(1, f.root.id, preview.revision, [
        { id: "file", action: "create" },
      ]),
    ).toThrow("DOWNLOAD_OVERWRITE_REQUIRED");
    f.targets.confirm(1, f.root.id, preview.revision, [
      { id: "file", action: "overwrite" },
    ]);
    await fs.writeFile(file, "external change");
    await expect(
      f.targets.file(1, f.root.id, "file", spec(Buffer.from("data"))),
    ).rejects.toThrow("DOWNLOAD_TARGET_CHANGED");
    expect(await fs.readFile(file, "utf8")).toBe("external change");
  });
  it("requires directory merge consent and skips a whole subtree when its parent is skipped", async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.selected, "项目"));
    const preview = await f.targets.preview(1, f.root.id, mapping);
    expect(
      preview.entries.find((e: { id: string }) => e.id === "folder").status,
    ).toBe("directory");
    expect(() =>
      f.targets.confirm(
        1,
        f.root.id,
        preview.revision,
        mapping.map((e) => ({ id: e.id, action: "create" })),
      ),
    ).toThrow("DOWNLOAD_OVERWRITE_REQUIRED");
    const confirmed = f.targets.confirm(
      1,
      f.root.id,
      preview.revision,
      mapping.map((e) => ({
        id: e.id,
        action: e.id === "folder" ? "skip" : "create",
      })),
    );
    expect(
      confirmed.entries.every((e: { action: string }) => e.action === "skip"),
    ).toBe(true);
    expect(
      (await f.targets.directories(1, f.root.id)).every(
        (e: { state: string }) => e.state === "skipped",
      ),
    ).toBe(true);
    await expect(
      f.targets.file(1, f.root.id, "file", spec(Buffer.from("data"))),
    ).rejects.toThrow("DOWNLOAD_NOT_READY");
    expect(await fs.readdir(path.join(f.selected, "项目"))).toEqual([]);
  });
  it("blocks reserved and escaping names and Windows case-fold collisions without creating anything", async () => {
    const f = await fixture();
    const bad = [
      "../escape",
      "C:\\escape",
      "CON.txt",
      "COM¹",
      "trailing.",
      "space ",
    ];
    const preview = await f.targets.preview(
      1,
      f.root.id,
      bad.map((name, i) => ({ id: String(i), name, kind: "file", size: 0 })),
    );
    expect(
      preview.entries.every((e: { status: string }) => e.status === "blocked"),
    ).toBe(true);
    if (process.platform === "win32") {
      const collision = await f.targets.preview(1, f.root.id, [
        { id: "a", name: "Report", kind: "file", size: 0 },
        { id: "b", name: "report", kind: "file", size: 0 },
      ]);
      expect(
        collision.entries.every(
          (e: { error: string }) =>
            e.error === "DOWNLOAD_TREE_DUPLICATE_TARGET",
        ),
      ).toBe(true);
    }
    expect(await fs.readdir(f.selected)).toEqual([]);
  });
  it("does not follow a directory junction and detects a parent replaced after confirmation", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.outside, "secret"), "keep");
    const link = path.join(f.selected, "link");
    await fs.symlink(
      f.outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const open = vi.spyOn(fs, "open");
    const preview = await f.targets.preview(1, f.root.id, [
      { id: "d", name: "link", kind: "directory", size: 0 },
      { id: "f", parentId: "d", name: "secret", kind: "file", size: 4 },
    ]);
    expect(
      preview.entries.every((e: { status: string }) => e.status === "blocked"),
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
    const next = await f.targets.preview(1, f.root.id, [
      { id: "d", name: "new", kind: "directory", size: 0 },
      { id: "f", parentId: "d", name: "secret", kind: "file", size: 4 },
    ]);
    f.targets.confirm(1, f.root.id, next.revision, [
      { id: "d", action: "create" },
      { id: "f", action: "create" },
    ]);
    await f.targets.directories(1, f.root.id);
    const changed = path.join(f.selected, "new");
    await fs.rmdir(changed);
    await fs.symlink(
      f.outside,
      changed,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      f.targets.file(1, f.root.id, "f", spec(Buffer.from("data"))),
    ).rejects.toThrow("DOWNLOAD_TARGET_CHANGED");
    expect(await fs.readFile(path.join(f.outside, "secret"), "utf8")).toBe(
      "keep",
    );
  });
  it("preserves an unknown result when creation succeeds but verification fails", async () => {
    const f = await fixture(),
      target = path.join(f.selected, "created");
    const preview = await f.targets.preview(1, f.root.id, [
      { id: "d", name: "created", kind: "directory", size: 0 },
    ]);
    f.targets.confirm(1, f.root.id, preview.revision, [
      { id: "d", action: "create" },
    ]);
    const nativeFs = require("node:fs/promises"),
      original = nativeFs.lstat.bind(nativeFs);
    let visits = 0;
    const inspect = vi
      .spyOn(nativeFs, "lstat")
      .mockImplementation(async (...args) => {
        if (args[0] === target && ++visits === 2)
          throw Object.assign(Error("verification denied"), { code: "EACCES" });
        return original(...args);
      });
    try {
      expect((await f.targets.directories(1, f.root.id))[0].state).toBe(
        "unknown",
      );
    } finally {
      inspect.mockRestore();
    }
    expect((await fs.stat(target)).isDirectory()).toBe(true);
    expect(() => f.targets.forget(1, f.root.id)).toThrow("DOWNLOAD_NOT_READY");
    expect((await f.targets.directories(1, f.root.id))[0].state).toBe(
      "unknown",
    );
  });
  it("isolates owners and rejects overlapping binding and forget operations", async () => {
    const f = await fixture();
    const preview = await f.targets.preview(1, f.root.id, [
      { id: "f", name: "file", kind: "file", size: 4 },
    ]);
    expect(() =>
      f.targets.confirm(2, f.root.id, preview.revision, [
        { id: "f", action: "create" },
      ]),
    ).toThrow("DOWNLOAD_NOT_FOUND");
    f.targets.confirm(1, f.root.id, preview.revision, [
      { id: "f", action: "create" },
    ]);
    let release!: () => void;
    const pending = new Promise<void>((r) => {
      release = r;
    });
    const original = f.sink.choose.bind(f.sink);
    const choose = vi
      .spyOn(f.sink, "choose")
      .mockImplementation(async (...args) => {
        await pending;
        return original(...args);
      });
    const first = f.targets.file(1, f.root.id, "f", spec(Buffer.from("data")));
    await vi.waitFor(() => expect(choose).toHaveBeenCalled());
    await expect(
      f.targets.file(1, f.root.id, "f", spec(Buffer.from("data"))),
    ).rejects.toThrow("DOWNLOAD_BUSY");
    expect(() => f.targets.forget(1, f.root.id)).toThrow("DOWNLOAD_BUSY");
    release();
    await first;
  });
});
it.each([
  ["ENOSPC", "DOWNLOAD_DISK_FULL"],
  ["EACCES", "DOWNLOAD_LOCAL_PERMISSION"],
])(
  "keeps batch members independent after partial local failure %s",
  async (code, error) => {
    const f = await fixture(),
      firstBytes = Buffer.from("done"),
      secondBytes = Buffer.alloc(131089, 91);
    const entries = [
      { id: "first", name: "first.bin", kind: "file", size: firstBytes.length },
      {
        id: "second",
        name: "second.bin",
        kind: "file",
        size: secondBytes.length,
      },
      { id: "third", name: "third.bin", kind: "file", size: 4 },
    ];
    const preview = await f.targets.preview(1, f.root.id, entries);
    f.targets.confirm(
      1,
      f.root.id,
      preview.revision,
      entries.map((e) => ({ id: e.id, action: "create" })),
    );
    const first = await f.targets.file(1, f.root.id, "first", spec(firstBytes));
    await f.sink.start(1, first.id, false);
    await f.sink.append(1, first.id, 0, firstBytes);
    await f.sink.finish(1, first.id);
    const receipt = f.targets.complete(1, f.root.id, "first"),
      firstPath = f.targets.show(1, f.root.id, "first"),
      metadata = await fs.stat(firstPath);
    const second = await f.targets.file(
        1,
        f.root.id,
        "second",
        spec(secondBytes),
      ),
      started = await f.sink.start(1, second.id, false);
    const handle = f.sink.owned(1, second.id)
        .handle as import("node:fs/promises").FileHandle,
      write = handle.write.bind(handle);
    const failure = vi
      .spyOn(handle, "write")
      .mockImplementationOnce(() => write(secondBytes, 0, 65536, 0))
      .mockRejectedValueOnce(Object.assign(Error("fixture failure"), { code }));
    try {
      await expect(f.sink.append(1, second.id, 0, secondBytes)).rejects.toThrow(
        error,
      );
    } finally {
      failure.mockRestore();
    }
    expect(f.sink.owned(1, second.id).view).toMatchObject({
      state: "failed",
      error,
      writtenBytes: 0,
      temporaryPath: started.temporaryPath,
    });
    expect((await fs.stat(started.temporaryPath)).size).toBe(65536);
    expect(() => f.targets.complete(1, f.root.id, "second")).toThrow(
      "DOWNLOAD_RESULT_UNVERIFIED",
    );
    await expect(
      f.targets.file(1, f.root.id, "first", spec(firstBytes)),
    ).rejects.toThrow("DOWNLOAD_NOT_READY");
    expect(f.targets.complete(1, f.root.id, "first")).toEqual(receipt);
    await expect(
      fs.stat(path.join(f.selected, "second.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(f.selected, "third.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await f.sink.resume(1, second.id);
    expect((await fs.stat(started.temporaryPath)).size).toBe(0);
    await f.sink.append(1, second.id, 0, secondBytes);
    await f.sink.finish(1, second.id);
    expect(f.targets.complete(1, f.root.id, "second")).toMatchObject({
      state: "completed",
      sha256: digest(secondBytes),
    });
    expect(await fs.readFile(path.join(f.selected, "second.bin"))).toEqual(
      secondBytes,
    );
    expect(await fs.readFile(firstPath)).toEqual(firstBytes);
    expect(await fs.stat(firstPath)).toMatchObject({
      ino: metadata.ino,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    });
    expect(f.targets.complete(1, f.root.id, "first")).toEqual(receipt);
    expect(() => f.targets.complete(1, f.root.id, "third")).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    await expect(
      fs.stat(path.join(f.selected, "third.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
