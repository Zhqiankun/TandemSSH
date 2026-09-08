const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const maximumBytes = 4 * 1024 * 1024;
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
const version = (s) =>
  [identity(s), s.size, s.mtimeMs, s.ctimeMs, s.mode].join(":");
const equivalent = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const code = (error) =>
  error instanceof Error && /^UPLOAD_[A-Z_]+$/.test(error.message)
    ? error.message
    : ["EACCES", "EPERM"].includes(error?.code)
      ? "UPLOAD_LOCAL_PERMISSION"
      : "UPLOAD_SOURCE_UNAVAILABLE";
class UploadSourceStore {
  constructor() {
    this.records = new Map();
    this.epochs = new Map();
    this.scanning = 0;
    this.reading = 0;
  }
  owned(owner, id) {
    const r = this.records.get(id);
    if (!r || r.owner !== owner) throw Error("UPLOAD_SOURCE_NOT_FOUND");
    return r;
  }
  guard(r, authorize) {
    if (authorize !== undefined && typeof authorize !== "function")
      throw Error("UPLOAD_REQUEST_INVALID");
    authorize?.();
    if (
      r.cancelled ||
      this.records.get(r.id) !== r ||
      (this.epochs.get(r.owner) ?? 0) !== r.epoch
    )
      throw Error("UPLOAD_CANCELLED");
  }
  view(r) {
    return {
      id: r.id,
      entries: [...r.entries.values()].map((e) => ({ ...e.view })),
      bytes: r.bytes,
      excluded: r.excluded,
    };
  }
  async select(owner, paths, authorize) {
    if (authorize !== undefined && typeof authorize !== "function")
      throw Error("UPLOAD_REQUEST_INVALID");
    authorize?.();
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > 4096 ||
      paths.some(
        (p) =>
          typeof p !== "string" ||
          !path.isAbsolute(p) ||
          /[\x00-\x1f\x7f]/.test(p),
      ) ||
      Buffer.byteLength(JSON.stringify(paths), "utf8") > 2 * 1024 * 1024
    )
      throw Error("UPLOAD_SOURCE_INVALID");
    if (
      this.scanning >= 2 ||
      this.records.size + this.scanning >= 16 ||
      [...this.records.values()].filter((r) => r.owner === owner).length >= 4
    )
      throw Error("UPLOAD_TREE_LIMIT");
    const r = {
      id: randomUUID(),
      owner,
      epoch: this.epochs.get(owner) ?? 0,
      entries: new Map(),
      bytes: 0,
      excluded: 0,
      cancelled: false,
    };
    this.records.set(r.id, r);
    this.scanning++;
    let metadata = 0;
    const seen = new Set();
    const append = (view, stat) => {
      metadata += Buffer.byteLength(JSON.stringify(view), "utf8");
      if (r.entries.size >= 4096 || metadata > 2 * 1024 * 1024)
        throw Error("UPLOAD_TREE_LIMIT");
      r.entries.set(view.id, {
        view,
        stat,
        version: version(stat),
        identity: identity(stat),
        busy: false,
      });
    };
    const walk = async (file, parentId, relative, depth) => {
      this.guard(r, authorize);
      if (depth > 64) throw Error("UPLOAD_TREE_LIMIT");
      const before = await fs.lstat(file);
      this.guard(r, authorize);
      const view = {
        id: randomUUID(),
        parentId,
        name: path.basename(file),
        path: file,
        relativePath: relative,
        kind: before.isSymbolicLink()
          ? "link"
          : before.isDirectory()
            ? "directory"
            : before.isFile()
              ? "file"
              : "other",
        size: before.isFile() ? before.size : 0,
        lastModified: Math.trunc(before.mtimeMs),
      };
      if (view.kind === "link" || view.kind === "other") {
        view.error = "UPLOAD_SOURCE_LINK_OR_SPECIAL";
        r.excluded++;
        append(view, before);
        return;
      }
      const actual = await fs.realpath(file);
      if (!equivalent(actual, file)) throw Error("UPLOAD_SOURCE_CHANGED");
      if (
        seen.has(process.platform === "win32" ? actual.toLowerCase() : actual)
      )
        return;
      seen.add(process.platform === "win32" ? actual.toLowerCase() : actual);
      if (
        view.kind === "file" &&
        (!Number.isSafeInteger(before.size) ||
          before.size < 0 ||
          before.size > maximumBytes * 16384)
      ) {
        view.error = "UPLOAD_SOURCE_TOO_LARGE";
        r.excluded++;
        append(view, before);
        return;
      }
      append(view, before);
      if (view.kind === "file") {
        r.bytes += before.size;
        if (!Number.isSafeInteger(r.bytes)) throw Error("UPLOAD_TREE_LIMIT");
        return;
      }
      const directory = await fs.opendir(file);
      let closed = false;
      try {
        for await (const child of directory) {
          this.guard(r, authorize);
          await walk(
            path.join(file, child.name),
            view.id,
            relative + "/" + child.name,
            depth + 1,
          );
        }
        closed = true;
      } finally {
        if (!closed) await directory.close().catch(() => {});
      }
      const after = await fs.lstat(file);
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        version(before) !== version(after)
      )
        throw Error("UPLOAD_SOURCE_CHANGED");
    };
    try {
      const normalized = [...new Set(paths.map((p) => path.resolve(p)))].sort(
          (a, b) => a.length - b.length,
        ),
        roots = [];
      for (const entry of normalized) {
        if (
          roots.some(
            (p) =>
              equivalent(entry, p) ||
              (process.platform === "win32"
                ? entry.toLowerCase()
                : entry
              ).startsWith(
                (process.platform === "win32" ? p.toLowerCase() : p) + path.sep,
              ),
          )
        )
          continue;
        roots.push(entry);
      }
      for (const file of roots) {
        const parent = await fs.realpath(path.dirname(file));
        await walk(
          path.join(parent, path.basename(file)),
          undefined,
          path.basename(file),
          0,
        );
      }
      this.guard(r, authorize);
      return this.view(r);
    } catch (error) {
      r.cancelled = true;
      this.records.delete(r.id);
      throw error;
    } finally {
      this.scanning--;
    }
  }
  async checked(owner, id, entryId, authorize) {
    const r = this.owned(owner, id),
      e = r.entries.get(entryId);
    this.guard(r, authorize);
    if (!e || e.view.kind !== "file" || e.view.error)
      throw Error("UPLOAD_SOURCE_UNAVAILABLE");
    let parent = e.view.parentId ? r.entries.get(e.view.parentId) : undefined;
    while (parent) {
      const s = await fs.lstat(parent.view.path);
      if (
        !s.isDirectory() ||
        s.isSymbolicLink() ||
        identity(s) !== parent.identity ||
        !equivalent(await fs.realpath(parent.view.path), parent.view.path)
      )
        throw Error("UPLOAD_SOURCE_CHANGED");
      this.guard(r, authorize);
      parent = parent.view.parentId
        ? r.entries.get(parent.view.parentId)
        : undefined;
    }
    const current = await fs.lstat(e.view.path);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      version(current) !== e.version ||
      !equivalent(await fs.realpath(e.view.path), e.view.path)
    )
      throw Error("UPLOAD_SOURCE_CHANGED");
    this.guard(r, authorize);
    return { r, e };
  }
  async check(owner, id, entryId, authorize) {
    const { e } = await this.checked(owner, id, entryId, authorize);
    return { ...e.view };
  }
  async chunk(owner, id, entryId, offset, length, authorize) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > maximumBytes
    )
      throw Error("UPLOAD_CHUNK_INVALID");
    const r = this.owned(owner, id),
      e = r.entries.get(entryId);
    this.guard(r, authorize);
    if (!e || e.view.kind !== "file" || offset + length > e.view.size)
      throw Error("UPLOAD_CHUNK_INVALID");
    if (e.busy || this.reading >= 4) throw Error("UPLOAD_BUSY");
    e.busy = true;
    this.reading++;
    let handle;
    try {
      await this.checked(owner, id, entryId, authorize);
      handle = await fs.open(
        e.view.path,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
      const before = await handle.stat();
      if (!before.isFile() || version(before) !== e.version)
        throw Error("UPLOAD_SOURCE_CHANGED");
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        this.guard(r, authorize);
        const result = await handle.read(
          bytes,
          read,
          Math.min(65536, length - read),
          offset + read,
        );
        if (!result.bytesRead) throw Error("UPLOAD_SOURCE_CHANGED");
        read += result.bytesRead;
      }
      if (version(await handle.stat()) !== e.version)
        throw Error("UPLOAD_SOURCE_CHANGED");
      await this.checked(owner, id, entryId, authorize);
      return new Uint8Array(bytes);
    } finally {
      try {
        await handle?.close();
      } finally {
        e.busy = false;
        this.reading--;
      }
    }
  }
  forget(owner, id) {
    const r = this.owned(owner, id);
    r.cancelled = true;
    this.records.delete(id);
    return null;
  }
  reset(owner) {
    this.epochs.set(owner, (this.epochs.get(owner) ?? 0) + 1);
    for (const r of [...this.records.values()])
      if (r.owner === owner) {
        r.cancelled = true;
        this.records.delete(r.id);
      }
  }
}
module.exports = { UploadSourceStore, code };
