const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readWindowsAttributes } = require("./windows-file-attributes.cjs");
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
const version = (s) =>
  [identity(s), s.size, s.mtimeMs, s.ctimeMs, s.mode].join(":");
const same = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const MAX_ENTRIES = 10000,
  PAGE_SIZE = 200;
function errorCode(error) {
  if (/^(LOCAL|UPLOAD|DOWNLOAD)_[A-Z_]+$/.test(error?.message))
    return error.message;
  if (["EPERM", "EACCES"].includes(error?.code))
    return "LOCAL_PERMISSION_DENIED";
  if (["ENOENT", "ENOTDIR"].includes(error?.code)) return "LOCAL_NOT_FOUND";
  return "LOCAL_IO_FAILED";
}
function segments(relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 8192 ||
    /[\\:\x00-\x1f\x7f]/.test(relative)
  )
    throw Error("LOCAL_PATH_INVALID");
  if (!relative) return [];
  const result = relative.split("/");
  if (result.length > 64 || result.some((s) => !s || s === "." || s === ".."))
    throw Error("LOCAL_PATH_INVALID");
  return result;
}
class LocalFileBrowser {
  constructor({ readAttributes = readWindowsAttributes } = {}) {
    this.readAttributes = readAttributes;
    this.roots = new Map();
    this.pending = 0;
    this.reading = 0;
    this.epochs = new Map();
  }
  guard(r) {
    if (
      this.roots.get(r.id) !== r ||
      (this.epochs.get(r.owner) ?? 0) !== r.epoch
    )
      throw Error("LOCAL_CANCELLED");
  }
  owned(owner, id) {
    const r = this.roots.get(id);
    if (!r || r.owner !== owner) throw Error("LOCAL_NOT_FOUND");
    this.guard(r);
    return r;
  }
  async select(owner, chosen, authorize = () => {}) {
    authorize();
    if (typeof chosen !== "string" || !path.isAbsolute(chosen))
      throw Error("LOCAL_PATH_INVALID");
    if (
      this.roots.size + this.pending >= 16 ||
      this.pending >= 4 ||
      [...this.roots.values()].filter((r) => r.owner === owner).length >= 4
    )
      throw Error("LOCAL_LIMIT");
    const epoch = this.epochs.get(owner) ?? 0;
    this.pending++;
    try {
      const actual = await fs.realpath(chosen),
        stat = await fs.lstat(actual);
      authorize();
      if ((this.epochs.get(owner) ?? 0) !== epoch)
        throw Error("LOCAL_CANCELLED");
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("LOCAL_PATH_INVALID");
      const r = {
        id: randomUUID(),
        owner,
        epoch,
        path: actual,
        identity: identity(stat),
        abort: new AbortController(),
        busy: false,
      };
      this.roots.set(r.id, r);
      return { id: r.id, path: r.path };
    } finally {
      this.pending--;
    }
  }
  async rootUnchanged(r) {
    this.guard(r);
    const stat = await fs.lstat(r.path);
    this.guard(r);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      identity(stat) !== r.identity ||
      !same(await fs.realpath(r.path), r.path)
    )
      throw Error("LOCAL_ROOT_CHANGED");
    this.guard(r);
  }
  async resolve(r, relative, expected) {
    const names = segments(relative);
    await this.rootUnchanged(r);
    let file = r.path,
      stat = await fs.lstat(file);
    for (let i = 0; i < names.length; i++) {
      file = path.join(file, names[i]);
      stat = await fs.lstat(file);
      this.guard(r);
      if (stat.isSymbolicLink()) throw Error("LOCAL_LINK_BLOCKED");
      if (i < names.length - 1 && !stat.isDirectory())
        throw Error("LOCAL_PATH_INVALID");
    }
    if (!same(await fs.realpath(file), file)) throw Error("LOCAL_ROOT_CHANGED");
    await this.rootUnchanged(r);
    if (expected !== undefined && version(stat) !== expected)
      throw Error("LOCAL_ENTRY_CHANGED");
    return { path: file, stat };
  }
  async list(owner, id, relative = "", options = {}) {
    const r = this.owned(owner, id);
    if (r.busy || this.reading >= 4) throw Error("LOCAL_BUSY");
    if (
      !options ||
      typeof options !== "object" ||
      !["name", "size", "modifiedAt"].includes(options.sort ?? "name") ||
      !["asc", "desc"].includes(options.order ?? "asc") ||
      typeof (options.search ?? "") !== "string" ||
      (options.search ?? "").length > 256 ||
      !Number.isInteger(options.offset ?? 0) ||
      (options.offset ?? 0) < 0 ||
      (options.offset ?? 0) > MAX_ENTRIES
    )
      throw Error("LOCAL_REQUEST_INVALID");
    r.busy = true;
    this.reading++;
    try {
      const directory = await this.resolve(r, relative);
      if (!directory.stat.isDirectory()) throw Error("LOCAL_PATH_INVALID");
      const entries = [],
        dir = await fs.opendir(directory.path);
      let truncated = false;
      try {
        for await (const entry of dir) {
          this.guard(r);
          if (entries.length === MAX_ENTRIES) {
            truncated = true;
            break;
          }
          entries.push(entry.name);
        }
      } finally {
        await dir.close().catch(() => {});
      }
      const rows = [];
      for (let at = 0; at < entries.length; at += 8) {
        this.guard(r);
        const batch = await Promise.all(
          entries.slice(at, at + 8).map(async (name) => {
            const rel = relative ? relative + "/" + name : name;
            try {
              const stat = await fs.lstat(path.join(directory.path, name));
              return {
                name,
                relativePath: rel,
                kind: stat.isSymbolicLink()
                  ? "link"
                  : stat.isDirectory()
                    ? "directory"
                    : stat.isFile()
                      ? "file"
                      : "other",
                size: stat.size,
                modifiedAt: stat.mtimeMs,
                hidden: name.startsWith("."),
                version: version(stat),
              };
            } catch (error) {
              return {
                name,
                relativePath: rel,
                kind: "other",
                size: 0,
                modifiedAt: 0,
                hidden: name.startsWith("."),
                version: "",
                error: errorCode(error),
              };
            }
          }),
        );
        rows.push(...batch);
      }
      let attributes = null;
      try {
        attributes = await this.readAttributes(
          directory.path,
          rows.map((row) => row.name),
          r.abort.signal,
        );
      } catch {
        this.guard(r);
        attributes = rows.map(() => null);
      }
      this.guard(r);
      let attributeWarning = false;
      if (attributes !== null) {
        if (!Array.isArray(attributes) || attributes.length !== rows.length)
          attributes = rows.map(() => null);
        rows.forEach((row, index) => {
          const bits = attributes[index],
            known = Number.isInteger(bits) && bits >= 0 && bits <= 0x7fffffff;
          row.attributesKnown = known;
          if (known) {
            row.hidden = row.hidden || !!(bits & 2);
            row.system = !!(bits & 4);
            row.readOnly = !!(bits & 1);
          } else attributeWarning = true;
        });
      }
      const after = await this.resolve(r, relative);
      if (
        identity(directory.stat) !== identity(after.stat) ||
        directory.stat.mtimeMs !== after.stat.mtimeMs
      )
        throw Error("LOCAL_ENTRY_CHANGED");
      const search = (options.search ?? "").toLocaleLowerCase(),
        sort = options.sort ?? "name",
        sign = options.order === "desc" ? -1 : 1;
      const selected = rows.filter(
        (e) =>
          (options.showHidden || (!e.hidden && !e.system)) &&
          e.name.toLocaleLowerCase().includes(search),
      );
      selected.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          sign *
            (sort === "name"
              ? a.name.localeCompare(b.name, "zh-CN", {
                  numeric: true,
                  sensitivity: "base",
                })
              : a[sort] - b[sort]) ||
          a.name.localeCompare(b.name),
      );
      const offset = options.offset ?? 0;
      return {
        rootId: id,
        path: directory.path,
        relativePath: relative,
        entries: selected.slice(offset, offset + PAGE_SIZE),
        total: selected.length,
        offset,
        nextOffset:
          offset + PAGE_SIZE < selected.length ? offset + PAGE_SIZE : null,
        truncated,
        ...(attributeWarning ? { attributeWarning: true } : {}),
      };
    } finally {
      r.busy = false;
      this.reading--;
    }
  }
  async withSelection(owner, id, entries, create, cleanup) {
    const r = this.owned(owner, id);
    if (!Array.isArray(entries) || !entries.length || entries.length > 4096)
      throw Error("LOCAL_REQUEST_INVALID");
    const paths = [];
    for (const entry of entries) {
      if (!entry || typeof entry.version !== "string" || !entry.version)
        throw Error("LOCAL_REQUEST_INVALID");
      const item = await this.resolve(r, entry.relativePath, entry.version);
      if (!item.stat.isFile() && !item.stat.isDirectory())
        throw Error("LOCAL_PATH_INVALID");
      paths.push(item.path);
    }
    const value = await create(paths, () => this.guard(r));
    try {
      for (const entry of entries)
        await this.resolve(r, entry.relativePath, entry.version);
      return value;
    } catch (error) {
      await cleanup(value);
      throw error;
    }
  }
  async withDirectory(owner, id, relative, create, cleanup) {
    const r = this.owned(owner, id),
      target = await this.resolve(r, relative);
    if (!target.stat.isDirectory()) throw Error("LOCAL_PATH_INVALID");
    const value = await create(target.path, () => this.guard(r));
    try {
      const after = await this.resolve(r, relative);
      if (identity(target.stat) !== identity(after.stat))
        throw Error("LOCAL_ROOT_CHANGED");
      return value;
    } catch (error) {
      await cleanup(value);
      throw error;
    }
  }
  release(owner, id) {
    const r = this.owned(owner, id);
    this.roots.delete(r.id);
    r.abort.abort();
  }
  reset(owner) {
    this.epochs.set(owner, (this.epochs.get(owner) ?? 0) + 1);
    for (const r of this.roots.values())
      if (r.owner === owner) {
        this.roots.delete(r.id);
        r.abort.abort();
      }
  }
}
module.exports = { LocalFileBrowser, errorCode };
