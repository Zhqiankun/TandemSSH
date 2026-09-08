import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  LocalFileGrants,
  type LocalTaskIdentity,
  type NativeTaskLocalFiles,
} from "../../files/local-file-grants";
import type {
  NativeTaskDirectoryAccess,
  DirectoryGrantReference,
} from "../../files/local-directory-ports";
import type { DownloadSource } from "../../../types/file-download";
import type { LocalDownloadTreeMapping } from "../../../types/download-tree";
const require = createRequire(import.meta.url),
  { TaskLocalFiles } = require("../../../../electron/task-local-files.cjs");
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
});
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const source = (bytes: Buffer): DownloadSource => ({
  id: randomUUID(),
  sessionId: "session",
  path: "/srv/file",
  canonicalPath: "/srv/file",
  size: bytes.length,
  sha256: hash(bytes),
  hashes: bytes.length ? [hash(bytes)] : [],
  chunkBytes: 4 * 1024 * 1024,
  state: "ready",
  expiresAt: Date.now() + 60000,
});
const mapping: LocalDownloadTreeMapping[] = [
  { id: "root", name: "项目", kind: "directory", size: 0 },
  { id: "empty", parentId: "root", name: "空目录", kind: "directory", size: 0 },
  { id: "file", parentId: "root", name: "中文 %.bin", kind: "file", size: 4 },
  { id: "zero", parentId: "root", name: "empty.bin", kind: "file", size: 0 },
];
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "task-directories-"));
  closers.push(async () => {
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("task-directories-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const upload = path.join(folder, "来源"),
    download = path.join(folder, "目标");
  await fs.mkdir(upload);
  await fs.mkdir(download);
  await fs.mkdir(path.join(upload, "空目录"));
  const bytes = Buffer.from([0, 128, 255, 13]);
  await fs.writeFile(path.join(upload, "中文 %.bin"), bytes);
  await fs.writeFile(path.join(upload, "empty.bin"), Buffer.alloc(0));
  const context: LocalTaskIdentity = {
      userId: "owner",
      taskId: randomUUID(),
      sessionId: randomUUID(),
      hostId: 1,
      hostName: "fixture",
      title: "目录授权",
      state: "ready",
      control: { generation: 1, controlEpoch: 1 },
    },
    native: NativeTaskLocalFiles = new TaskLocalFiles(),
    audit = vi.fn(async () => {}),
    service = new LocalFileGrants({
      native: () => native,
      available: () => true,
      context: () => structuredClone(context),
      audit,
    });
  closers.push(() => service.dispose());
  const token = randomUUID();
  service.bindWindow(token);
  let authorized = true;
  const guard = () => {
    if (!authorized) throw Error("STALE_CONTROL");
  };
  const choose = async (
    direction: "upload" | "download",
    allowOverwrite = false,
    chosen = direction === "upload" ? upload : download,
  ) => {
    const t = service.issue("owner", context.taskId, {
      windowToken: token,
      direction,
      kind: "directory",
      allowOverwrite,
    });
    expect(service.claim(token, t.id)).toMatchObject({
      kind: "directory",
      direction,
    });
    const grant = (await service.fulfill(token, t.id, [chosen])).grants[0];
    const ref: DirectoryGrantReference = {
      localGrantId: grant.id,
      localVersion: grant.version,
      direction,
      overwrite: allowOverwrite,
    };
    return {
      grant,
      ref,
      access: service.directory(
        context,
        ref,
        guard,
        new AbortController().signal,
      ),
    };
  };
  return {
    folder,
    upload,
    download,
    bytes,
    context,
    native,
    service,
    audit,
    token,
    choose,
    guard,
    revokeControl: () => {
      authorized = false;
    },
  };
}
function confirm(
  access: NativeTaskDirectoryAccess,
  preview: Awaited<ReturnType<NativeTaskDirectoryAccess["previewDownload"]>>,
) {
  return access.confirmDownload(
    preview.id,
    preview.revision,
    preview.entries.map((e) => ({
      id: e.id,
      action:
        e.status === "directory"
          ? "merge"
          : e.status === "conflict"
            ? "overwrite"
            : e.status === "blocked"
              ? "skip"
              : "create",
    })),
  );
}
it("grants an immutable directory snapshot, excludes links and shares versioned file reads", async () => {
  const f = await fixture(),
    outside = path.join(f.folder, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret"), "not selected");
  await fs.symlink(outside, path.join(f.upload, "link"), "junction");
  const { grant, ref, access } = await f.choose("upload");
  expect(grant).toMatchObject({ kind: "directory", excluded: 1, size: 4 });
  const entries = access.uploadEntries();
  expect(JSON.stringify(entries)).not.toContain(f.folder);
  expect(entries.some((e) => e.kind === "link" && e.error)).toBe(true);
  await fs.writeFile(path.join(f.upload, "new.bin"), "not in snapshot");
  expect(access.uploadEntries().some((e) => e.name === "new.bin")).toBe(false);
  const entry = entries.find((e) => e.name === "中文 %.bin")!,
    file = await access.uploadFile(entry.id);
  expect(file.manifest.hashes).toEqual([hash(f.bytes)]);
  expect(await file.read(0, 4)).toEqual(f.bytes);
  await file.verify();
  await file.close();
  await expect(file.read(0, 4)).rejects.toThrow("FILE_LOCAL_ACCESS_CLOSED");
  await expect(
    access.uploadFile(entries.find((e) => e.kind === "link")!.id),
  ).rejects.toThrow("FILE_LOCAL_GRANT_REQUIRED");
  expect(() =>
    f.service.assert(f.context, {
      type: "file.upload",
      path: "/srv/file",
      localGrantId: ref.localGrantId,
      localVersion: ref.localVersion,
      overwrite: false,
    }),
  ).toThrow("FILE_LOCAL_GRANT_REQUIRED");
});
it("refuses a changed upload source and revokes already opened directory file access", async () => {
  const f = await fixture(),
    { grant, access } = await f.choose("upload"),
    entry = access.uploadEntries().find((e) => e.name === "中文 %.bin")!,
    file = await access.uploadFile(entry.id);
  await fs.writeFile(path.join(f.upload, entry.name), "changed");
  await expect(file.verify()).rejects.toThrow("UPLOAD_SOURCE_CHANGED");
  await file.close();
  const empty = await access.uploadFile(
    access.uploadEntries().find((e) => e.name === "empty.bin")!.id,
  );
  await f.service.revoke("owner", f.context.taskId, grant.id);
  await expect(empty.verify()).rejects.toThrow(/REVOKED/);
  await empty.close();
});
it("keeps previews read-only, creates empty directories and commits exact bytes without retaining file handles", async () => {
  const f = await fixture(),
    { grant, access } = await f.choose("download"),
    preview = await access.previewDownload(mapping);
  expect(await fs.readdir(f.download)).toEqual([]);
  confirm(access, preview);
  expect(await fs.readdir(f.download)).toEqual([]);
  const events: string[] = [];
  await access.createDownloadDirectories(
    preview.id,
    async (type) => {
      events.push(type);
    },
    () => {},
  );
  expect(events).toEqual([
    "local_directory.entry-started",
    "local_directory.entry-completed",
    "local_directory.entry-started",
    "local_directory.entry-completed",
  ]);
  for (const [id, bytes] of [
    ["file", f.bytes],
    ["zero", Buffer.alloc(0)],
  ] as const) {
    const file = await access.downloadFile(preview.id, id, source(bytes));
    await file.start(false);
    if (bytes.length) await file.append(0, bytes);
    expect((await file.finish()).state).toBe("completed");
    await file.close();
    expect(file.snapshot().sha256).toBe(hash(bytes));
  }
  expect(
    await fs.readFile(path.join(f.download, "项目", "中文 %.bin")),
  ).toEqual(f.bytes);
  expect(await fs.readdir(path.join(f.download, "项目", "空目录"))).toEqual([]);
  const state = f.service.directoryState(f.context, grant.id, preview.id);
  expect(state.transfers).toHaveLength(2);
  expect(
    state.entries
      .filter((e) => e.kind === "file")
      .every((e) => e.result?.state === "completed"),
  ).toBe(true);
  f.service.forgetDirectoryPreview(f.context, grant.id, preview.id);
  expect(
    await fs.readFile(path.join(f.download, "项目", "中文 %.bin")),
  ).toEqual(f.bytes);
});
it("stops subsequent directory creation when an entry loses authorization", async () => {
  const f = await fixture(),
    { access } = await f.choose("download"),
    preview = await access.previewDownload(mapping);
  confirm(access, preview);
  await expect(
    access.createDownloadDirectories(
      preview.id,
      async () => {},
      (entryId) => {
        if (entryId === "empty") throw Error("POLICY_DENIED");
      },
    ),
  ).rejects.toThrow("POLICY_DENIED");
  expect((await fs.stat(path.join(f.download, "项目"))).isDirectory()).toBe(
    true,
  );
  await expect(
    fs.stat(path.join(f.download, "项目", "空目录")),
  ).rejects.toThrow();
  expect(
    access.downloadState(preview.id).entries.find((e) => e.id === "root")
      ?.result?.state,
  ).toBe("created");
});
it.each(["before", "after"] as const)(
  "preserves accurate results if directory audit fails %s writing",
  async (phase) => {
    const f = await fixture(),
      { grant, access } = await f.choose("download"),
      preview = await access.previewDownload(mapping);
    confirm(access, preview);
    await expect(
      access.createDownloadDirectories(
        preview.id,
        async (type) => {
          if (
            type ===
            (phase === "before"
              ? "local_directory.entry-started"
              : "local_directory.entry-completed")
          )
            throw Error("AUDIT_UNAVAILABLE");
        },
        () => {},
      ),
    ).rejects.toThrow("AUDIT_UNAVAILABLE");
    const state = f.service.directoryState(f.context, grant.id, preview.id);
    expect(state.entries.find((e) => e.id === "root")?.result?.state).toBe(
      phase === "before" ? "failed" : "unknown",
    );
    await expect(
      fs.stat(path.join(f.download, "项目", "空目录")),
    ).rejects.toThrow();
    if (phase === "after")
      expect(() =>
        f.service.forgetDirectoryPreview(f.context, grant.id, preview.id),
      ).toThrow("DOWNLOAD_NOT_READY");
  },
);
it("checks task control again at the final local file commit", async () => {
  const f = await fixture(),
    { grant, access } = await f.choose("download"),
    preview = await access.previewDownload(mapping);
  confirm(access, preview);
  await access.createDownloadDirectories(
    preview.id,
    async () => {},
    () => {},
  );
  const file = await access.downloadFile(preview.id, "file", source(f.bytes));
  await file.start(false);
  await file.append(0, f.bytes);
  f.revokeControl();
  await expect(file.finish()).rejects.toThrow("STALE_CONTROL");
  await file.close();
  await expect(
    fs.stat(path.join(f.download, "项目", "中文 %.bin")),
  ).rejects.toThrow();
  expect(
    f.service.directoryState(f.context, grant.id, preview.id).transfers[0]
      .transfer.state,
  ).not.toBe("completed");
});
it("requires overwrite authorization, fixes the preview revision and detects target changes", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.download, "old.bin"), "original");
  const denied = await f.choose("download"),
    mapping: LocalDownloadTreeMapping[] = [
      { id: "f", name: "old.bin", kind: "file", size: 4 },
    ],
    p = await denied.access.previewDownload(mapping);
  expect(() => confirm(denied.access, p)).toThrow(
    "FILE_LOCAL_OVERWRITE_REQUIRED",
  );
  const allowed = await f.choose("download", true),
    preview = await allowed.access.previewDownload(mapping);
  expect(() =>
    allowed.access.confirmDownload(preview.id, randomUUID(), [
      { id: "f", action: "overwrite" },
    ]),
  ).toThrow("DOWNLOAD_NOT_READY");
  confirm(allowed.access, preview);
  await fs.writeFile(path.join(f.download, "old.bin"), "external change");
  await expect(
    allowed.access.downloadFile(preview.id, "f", source(f.bytes)),
  ).rejects.toThrow(/TARGET_CHANGED/);
  expect(await fs.readFile(path.join(f.download, "old.bin"), "utf8")).toBe(
    "external change",
  );
});
it("rejects foreign tasks, stale grant versions and previews from another directory grant", async () => {
  const f = await fixture(),
    a = await f.choose("download"),
    b = await f.choose("download"),
    preview = await a.access.previewDownload(mapping);
  expect(() =>
    f.service.directory(
      { ...f.context, taskId: randomUUID() },
      a.ref,
      () => {},
      new AbortController().signal,
    ),
  ).toThrow("FILE_LOCAL_GRANT_NOT_FOUND");
  expect(() =>
    f.service.directory(
      f.context,
      { ...a.ref, localVersion: randomUUID() },
      () => {},
      new AbortController().signal,
    ),
  ).toThrow("FILE_LOCAL_DIRECTORY_REQUIRED");
  expect(() =>
    b.access.confirmDownload(preview.id, preview.revision, []),
  ).toThrow("FILE_LOCAL_GRANT_REQUIRED");
  f.service.closeWindow(f.token);
  await expect(a.access.previewDownload(mapping)).rejects.toThrow(
    /WINDOW_CLOSED|REVOKED/,
  );
});
it("blocks path escape and a replaced local parent before child file access", async () => {
  const f = await fixture(),
    { access } = await f.choose("download"),
    bad = await access.previewDownload([
      { id: "escape", name: "../escape", kind: "file", size: 0 },
    ]);
  expect(bad.entries[0].status).toBe("blocked");
  const preview = await access.previewDownload(mapping);
  confirm(access, preview);
  await access.createDownloadDirectories(
    preview.id,
    async () => {},
    () => {},
  );
  const root = path.join(f.download, "项目"),
    outside = path.join(f.folder, "other");
  await fs.mkdir(outside);
  await fs.rename(root, path.join(f.download, "moved"));
  await fs.symlink(outside, root, "junction");
  await expect(
    access.downloadFile(preview.id, "file", source(f.bytes)),
  ).rejects.toThrow("DOWNLOAD_TARGET_CHANGED");
  expect(await fs.readdir(outside)).toEqual([]);
});
it("releases selection reservations when a directory scan is interrupted", async () => {
  const f = await fixture(),
    original = fs.opendir;
  let interrupted = false;
  vi.spyOn(fs, "opendir").mockImplementation(
    async (...args: Parameters<typeof fs.opendir>) => {
      const dir = await original(...args);
      if (!interrupted) {
        interrupted = true;
        f.service.closeWindow(f.token);
      }
      return dir;
    },
  );
  await expect(f.choose("upload")).rejects.toThrow(/TICKET|WINDOW/);
  expect(f.service.list("owner", f.context.taskId)).toEqual([]);
  vi.restoreAllMocks();
  f.service.bindWindow(f.token);
  const chosen = await f.choose("upload");
  expect(chosen.grant.kind).toBe("directory");
});
it("bounds directory grants and frees capacity without deleting selected data", async () => {
  const f = await fixture(),
    grants = [];
  for (let i = 0; i < 4; i++) grants.push(await f.choose("upload"));
  await expect(f.choose("upload")).rejects.toThrow("FILE_LOCAL_GRANT_LIMIT");
  await f.service.forget("owner", f.context.taskId, grants[0].grant.id);
  expect((await f.choose("upload")).grant.kind).toBe("directory");
  expect(await fs.readFile(path.join(f.upload, "中文 %.bin"))).toEqual(f.bytes);
  expect(
    JSON.stringify(f.service.list("owner", f.context.taskId)),
  ).not.toContain(f.folder);
});
it("creates only the selected local directory for one task operation", async () => {
  const f = await fixture(),
    { access } = await f.choose("download"),
    preview = await access.previewDownload(mapping);
  confirm(access, preview);
  await expect(
    access.createDownloadDirectories(
      preview.id,
      async () => {},
      () => {},
      "missing",
    ),
  ).rejects.toThrow("FILE_DIRECTORY_ENTRY_INVALID");
  expect(await fs.readdir(f.download)).toEqual([]);
  const first = await access.createDownloadDirectories(
    preview.id,
    async () => {},
    () => {},
    "root",
  );
  expect(first).toHaveLength(1);
  expect(first[0].id).toBe("root");
  await expect(
    fs.stat(path.join(f.download, "项目", "空目录")),
  ).rejects.toThrow();
  const next = await access.createDownloadDirectories(
    preview.id,
    async () => {},
    () => {},
    "empty",
  );
  expect(next).toHaveLength(1);
  expect(
    (await fs.stat(path.join(f.download, "项目", "空目录"))).isDirectory(),
  ).toBe(true);
});
