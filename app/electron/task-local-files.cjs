// Pure Node file capabilities. Electron only supplies native picker results through private IPC.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto");
const { UploadSourceStore } = require("./upload-sources.cjs");
const {
  DownloadSink,
  inspectDownloadTarget,
  CHUNK_BYTES,
} = require("./download-sink.cjs");
const { validName } = require("./download-directory-targets.cjs");
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
class TaskLocalFiles {
  constructor() {
    this.sources = new UploadSourceStore();
    this.sink = new DownloadSink();
    this.records = new Map();
    this.groups = new Map();
  }
  owned(id) {
    const r = this.records.get(id);
    if (!r) throw Error("FILE_LOCAL_GRANT_NOT_FOUND");
    return r;
  }
  guard(r, authorize) {
    if (r.revoked || this.records.get(r.id) !== r)
      throw Error("FILE_LOCAL_GRANT_REVOKED");
    authorize();
  }
  view(id) {
    const r = this.owned(id),
      local = r.downloadId
        ? this.sink.view(this.sink.owned(r.owner, r.downloadId))
        : undefined;
    return {
      id: r.id,
      version: r.version,
      direction: r.direction,
      name: r.name,
      path: r.path,
      size: r.size,
      existing: r.baseline
        ? { size: r.baseline.stat.size, modifiedAt: r.baseline.stat.mtimeMs }
        : undefined,
      temporaryPath: local?.temporaryPath,
      transferState: local?.state,
      busy: r.busy,
      consumed: local?.state === "completed",
    };
  }
  async select(direction, owner, paths, authorize) {
    authorize();
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > 32 ||
      paths.some(
        (p) =>
          typeof p !== "string" ||
          !path.isAbsolute(p) ||
          /[\x00-\x1f\x7f]/.test(p),
      )
    )
      throw Error("FILE_LOCAL_SELECTION_INVALID");
    if (this.records.size + paths.length > 128)
      throw Error("FILE_LOCAL_GRANT_LIMIT");
    if (direction === "upload") {
      const selection = await this.sources.select(owner, paths);
      try {
        authorize();
        if (selection.entries.some((e) => e.kind !== "file" || e.error))
          throw Error("FILE_LOCAL_SOURCE_UNSUPPORTED");
        const group = { id: selection.id, owner, remaining: new Set() };
        const records = selection.entries.map((e) => ({
          id: randomUUID(),
          version: randomUUID(),
          direction,
          owner,
          name: e.name,
          path: e.path,
          size: e.size,
          selectionId: selection.id,
          entry: e,
          revoked: false,
          busy: false,
        }));
        for (const r of records) {
          group.remaining.add(r.id);
          this.records.set(r.id, r);
        }
        this.groups.set(selection.id, group);
        return records.map((r) => this.view(r.id));
      } catch (e) {
        this.sources.forget(owner, selection.id);
        throw e;
      }
    }
    if (direction !== "download" || paths.length !== 1)
      throw Error("FILE_LOCAL_SELECTION_INVALID");
    const name = path.basename(paths[0]);
    if (!validName(name)) throw Error("DOWNLOAD_LOCAL_NAME_INVALID");
    const parent = await fs.realpath(path.dirname(paths[0])),
      parentStat = await fs.lstat(parent);
    authorize();
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
      throw Error("DOWNLOAD_TARGET_CHANGED");
    const target = path.join(parent, name),
      baseline = await inspectDownloadTarget(target, authorize);
    authorize();
    if (identity(await fs.stat(parent)) !== identity(parentStat))
      throw Error("DOWNLOAD_TARGET_CHANGED");
    const r = {
      id: randomUUID(),
      version: randomUUID(),
      direction,
      owner,
      name,
      path: target,
      parent: { path: parent, identity: identity(parentStat) },
      baseline,
      revoked: false,
      busy: false,
    };
    this.records.set(r.id, r);
    return [this.view(r.id)];
  }
  async upload(id, authorize, signal) {
    const r = this.owned(id),
      guard = () => {
        if (signal.aborted) throw Error("FILE_TRANSFER_CANCELLED");
        this.guard(r, authorize);
      };
    if (r.direction !== "upload" || r.busy)
      throw Error("FILE_LOCAL_GRANT_BUSY");
    guard();
    r.busy = true;
    try {
      await this.sources.check(r.owner, r.selectionId, r.entry.id, guard);
      const hashes = [];
      for (let at = 0; at < r.entry.size; at += CHUNK_BYTES) {
        guard();
        const bytes = await this.sources.chunk(
          r.owner,
          r.selectionId,
          r.entry.id,
          at,
          Math.min(CHUNK_BYTES, r.entry.size - at),
          guard,
        );
        hashes.push(createHash("sha256").update(bytes).digest("hex"));
      }
      guard();
      return {
        manifest: {
          name: r.name,
          size: r.entry.size,
          lastModified: r.entry.lastModified,
          hashes,
        },
        read: async (offset, length) => {
          guard();
          return Buffer.from(
            await this.sources.chunk(
              r.owner,
              r.selectionId,
              r.entry.id,
              offset,
              length,
              guard,
            ),
          );
        },
        verify: async () => {
          guard();
          await this.sources.check(r.owner, r.selectionId, r.entry.id, guard);
        },
        close: () => {
          r.busy = false;
        },
      };
    } catch (e) {
      r.busy = false;
      throw e;
    }
  }
  async download(id, source, authorize, signal) {
    const r = this.owned(id),
      guard = () => {
        if (signal.aborted) throw Error("FILE_TRANSFER_CANCELLED");
        this.guard(r, authorize);
      };
    if (r.direction !== "download" || r.busy || r.downloadId)
      throw Error("FILE_LOCAL_GRANT_BUSY");
    guard();
    r.busy = true;
    try {
      const local = await this.sink.choose(
        r.owner,
        {
          name: r.name,
          size: source.size,
          sha256: source.sha256,
          hashes: source.hashes,
        },
        async () => r.path,
        { parent: r.parent, value: r.baseline },
        guard,
      );
      r.downloadId = local.id;
      guard();
      return {
        snapshot: () => this.sink.view(this.sink.owned(r.owner, local.id)),
        start: (overwrite) => this.sink.start(r.owner, local.id, overwrite),
        append: (offset, bytes) =>
          this.sink.append(r.owner, local.id, offset, bytes),
        finish: () => this.sink.finish(r.owner, local.id),
        close: async () => {
          const record = this.sink.owned(r.owner, local.id);
          try {
            await record.tail;
            if (record.handle) {
              await record.handle.close();
              record.handle = undefined;
            }
          } finally {
            r.busy = false;
          }
        },
      };
    } catch (e) {
      r.busy = false;
      throw e;
    }
  }
  revoke(id) {
    this.owned(id).revoked = true;
  }
  async forget(id) {
    const r = this.owned(id);
    r.revoked = true;
    if (r.busy) throw Error("FILE_LOCAL_GRANT_BUSY");
    if (r.downloadId) {
      const record = this.sink.owned(r.owner, r.downloadId);
      if (record.view.state === "unknown")
        throw Error("FILE_TRANSFER_CLEANUP_PENDING");
      await this.sink.cancel(r.owner, r.downloadId);
      await this.sink.forget(r.owner, r.downloadId);
    }
    if (r.selectionId) {
      const group = this.groups.get(r.selectionId);
      group.remaining.delete(r.id);
      if (!group.remaining.size) {
        this.sources.forget(r.owner, r.selectionId);
        this.groups.delete(r.selectionId);
      }
    }
    this.records.delete(id);
  }
  async dispose() {
    for (const r of this.records.values()) r.revoked = true;
    for (const r of this.records.values())
      if (!r.busy) await this.forget(r.id).catch(() => {});
  }
}
module.exports = { TaskLocalFiles };
