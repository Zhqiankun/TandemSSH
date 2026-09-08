const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  inspectDownloadTarget,
  errorCode,
  CHUNK_BYTES,
  MAX_CHUNKS,
} = require("./download-sink.cjs");
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
const pathKey = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const validName = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 255 &&
  !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) &&
  !/[ .]$/.test(name) &&
  ![".", ".."].includes(name) &&
  !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(
    name,
  );
async function stat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
class DownloadDirectoryTargets {
  constructor(sink) {
    this.sink = sink;
    this.roots = new Map();
    this.choosing = false;
  }
  owned(owner, id) {
    const r = this.roots.get(id);
    if (!r || r.owner !== owner) throw Error("DOWNLOAD_NOT_FOUND");
    return r;
  }
  guard(r, authorize) {
    if (authorize !== undefined && typeof authorize !== "function")
      throw Error("DOWNLOAD_REQUEST_INVALID");
    authorize?.();
    if (r.cancelled || this.roots.get(r.id) !== r)
      throw Error("DOWNLOAD_CANCELLED");
    r.touched = Date.now();
  }
  async rootUnchanged(r, authorize) {
    this.guard(r, authorize);
    const current = await fs.lstat(r.path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      identity(current) !== r.identity ||
      pathKey(await fs.realpath(r.path)) !== pathKey(r.path)
    )
      throw Error("DOWNLOAD_TARGET_CHANGED");
    this.guard(r, authorize);
  }
  view(r) {
    return {
      id: r.id,
      path: r.path,
      revision: r.revision,
      state: r.cancelled ? "cancelled" : r.confirmed ? "ready" : "preview",
      entries: [...r.entries.values()].map((e) => ({
        id: e.id,
        parentId: e.parentId,
        name: e.name,
        kind: e.kind,
        size: e.size,
        relativePath: e.names.join("/"),
        path: e.path,
        status: e.status,
        existing: e.snapshot
          ? { size: e.snapshot.stat.size, modifiedAt: e.snapshot.stat.mtimeMs }
          : undefined,
        error: e.error,
        action: e.action,
        result: e.result,
      })),
    };
  }
  async choose(owner, chooseDirectory, authorize) {
    authorize?.();
    if (
      this.choosing ||
      this.roots.size >= 8 ||
      [...this.roots.values()].filter((r) => r.owner === owner).length >= 4
    )
      throw Error("DOWNLOAD_TREE_LIMIT");
    this.choosing = true;
    try {
      const chosen = await chooseDirectory();
      authorize?.();
      if (!chosen) return null;
      if (!path.isAbsolute(chosen)) throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
      const directory = await fs.realpath(chosen),
        meta = await fs.lstat(directory);
      if (!meta.isDirectory() || meta.isSymbolicLink())
        throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
      const r = {
        id: randomUUID(),
        owner,
        path: directory,
        identity: identity(meta),
        entries: new Map(),
        revision: randomUUID(),
        cancelled: false,
        confirmed: false,
        busy: false,
        touched: Date.now(),
      };
      authorize?.();
      this.roots.set(r.id, r);
      return this.view(r);
    } finally {
      this.choosing = false;
    }
  }
  async previewParentsUnchanged(r, e, entries, authorize) {
    await this.rootUnchanged(r, authorize);
    let parent = e.parentId ? entries.get(e.parentId) : undefined;
    while (parent) {
      if (parent.status !== "directory")
        throw Error("DOWNLOAD_TREE_PARENT_UNAVAILABLE");
      const current = await fs.lstat(parent.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        identity(current) !== parent.directoryIdentity ||
        pathKey(await fs.realpath(parent.path)) !== pathKey(parent.path)
      )
        throw Error("DOWNLOAD_TARGET_CHANGED");
      this.guard(r, authorize);
      parent = parent.parentId ? entries.get(parent.parentId) : undefined;
    }
  }
  async preview(owner, id, raw, authorize) {
    const r = this.owned(owner, id);
    if (r.busy) throw Error("DOWNLOAD_BUSY");
    if (r.confirmed) throw Error("DOWNLOAD_NOT_READY");
    if (
      !Array.isArray(raw) ||
      !raw.length ||
      raw.length > 4096 ||
      Buffer.byteLength(JSON.stringify(raw), "utf8") > 2 * 1024 * 1024
    )
      throw Error("DOWNLOAD_TREE_LIMIT");
    r.busy = true;
    try {
      await this.rootUnchanged(r, authorize);
      const entries = new Map(),
        active = new Set();
      for (const value of raw) {
        if (
          !value ||
          typeof value.id !== "string" ||
          value.id.length > 128 ||
          !value.id ||
          entries.has(value.id) ||
          typeof value.name !== "string" ||
          !["file", "directory"].includes(value.kind) ||
          !Number.isSafeInteger(value.size) ||
          value.size < 0 ||
          value.size > CHUNK_BYTES * MAX_CHUNKS ||
          (value.parentId !== undefined && typeof value.parentId !== "string")
        )
          throw Error("DOWNLOAD_REQUEST_INVALID");
        entries.set(value.id, {
          id: value.id,
          parentId: value.parentId,
          name: value.name,
          kind: value.kind,
          size: value.size,
          status: "new",
        });
      }
      const build = (e) => {
        if (e.names) return;
        if (active.has(e.id) || active.size > 64)
          throw Error("DOWNLOAD_REQUEST_INVALID");
        active.add(e.id);
        const parent =
          e.parentId === undefined ? undefined : entries.get(e.parentId);
        if (
          e.parentId !== undefined &&
          (!parent || parent.kind !== "directory")
        )
          throw Error("DOWNLOAD_REQUEST_INVALID");
        if (parent) build(parent);
        e.names = [...(parent?.names ?? []), e.name];
        if (e.names.length > 65) throw Error("DOWNLOAD_TREE_LIMIT");
        if (
          e.names.some((name) => !validName(name)) ||
          e.names.join("/").length > 4096
        ) {
          e.status = "blocked";
          e.error = "DOWNLOAD_LOCAL_NAME_INVALID";
        } else e.path = path.join(r.path, ...e.names);
        active.delete(e.id);
      };
      for (const e of entries.values()) build(e);
      const paths = new Map();
      for (const e of entries.values())
        if (e.path) {
          const key = pathKey(e.path),
            old = paths.get(key);
          if (old) {
            old.status = e.status = "blocked";
            old.error = e.error = "DOWNLOAD_TREE_DUPLICATE_TARGET";
          } else paths.set(key, e);
        }
      for (const e of [...entries.values()].sort(
        (a, b) => a.names.length - b.names.length,
      )) {
        this.guard(r, authorize);
        if (e.status === "blocked") continue;
        const parent = e.parentId ? entries.get(e.parentId) : undefined;
        if (parent?.status === "blocked") {
          e.status = "blocked";
          e.error = "DOWNLOAD_TREE_PARENT_UNAVAILABLE";
          continue;
        }
        if (parent?.status === "new") continue;
        try {
          await this.previewParentsUnchanged(r, e, entries, authorize);
          const current = await stat(e.path);
          this.guard(r, authorize);
          if (!current) continue;
          if (
            current.isSymbolicLink() ||
            (!current.isFile() && !current.isDirectory())
          )
            throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
          if (e.kind === "directory") {
            if (!current.isDirectory())
              throw Error("DOWNLOAD_TREE_TYPE_CONFLICT");
            e.status = "directory";
            e.directoryIdentity = identity(current);
          } else {
            if (!current.isFile()) throw Error("DOWNLOAD_TREE_TYPE_CONFLICT");
            const snapshot = await inspectDownloadTarget(e.path, () =>
              this.guard(r, authorize),
            );
            if (!snapshot) throw Error("DOWNLOAD_TARGET_CHANGED");
            await this.previewParentsUnchanged(r, e, entries, authorize);
            // Keep one full-file digest, not its per-block manifest, for each existing target.
            e.snapshot = { stat: snapshot.stat, sha256: snapshot.sha256 };
            e.status = "conflict";
          }
        } catch (error) {
          this.guard(r, authorize);
          e.status = "blocked";
          e.error = errorCode(error);
        }
      }
      await this.rootUnchanged(r, authorize);
      r.entries = entries;
      r.revision = randomUUID();
      return this.view(r);
    } finally {
      r.busy = false;
    }
  }
  confirm(owner, id, revision, decisions, authorize) {
    const r = this.owned(owner, id);
    this.guard(r, authorize);
    if (r.busy) throw Error("DOWNLOAD_BUSY");
    if (
      r.confirmed ||
      !r.entries.size ||
      r.revision !== revision ||
      !Array.isArray(decisions) ||
      decisions.length !== r.entries.size
    )
      throw Error("DOWNLOAD_NOT_READY");
    const choices = new Map();
    for (const d of decisions) {
      if (
        !d ||
        !r.entries.has(d.id) ||
        choices.has(d.id) ||
        !["create", "merge", "overwrite", "skip"].includes(d.action)
      )
        throw Error("DOWNLOAD_REQUEST_INVALID");
      choices.set(d.id, d.action);
    }
    const actions = new Map();
    for (const e of [...r.entries.values()].sort(
      (a, b) => a.names.length - b.names.length,
    )) {
      const action =
        e.parentId && actions.get(e.parentId) === "skip"
          ? "skip"
          : choices.get(e.id);
      if (
        action !== "skip" &&
        (e.status === "blocked" ||
          (e.status === "new"
            ? action !== "create"
            : e.status === "directory"
              ? action !== "merge"
              : action !== "overwrite"))
      )
        throw Error("DOWNLOAD_OVERWRITE_REQUIRED");
      actions.set(e.id, action);
    }
    for (const e of r.entries.values()) e.action = actions.get(e.id);
    r.confirmed = true;
    return this.view(r);
  }
  async parentsUnchanged(r, e, authorize) {
    await this.rootUnchanged(r, authorize);
    let parent = e.parentId ? r.entries.get(e.parentId) : undefined;
    while (parent) {
      if (!["created", "merged"].includes(parent.result?.state))
        throw Error("DOWNLOAD_TREE_PARENT_UNAVAILABLE");
      const current = await fs.lstat(parent.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        identity(current) !== parent.directoryIdentity ||
        pathKey(await fs.realpath(parent.path)) !== pathKey(parent.path)
      )
        throw Error("DOWNLOAD_TARGET_CHANGED");
      this.guard(r, authorize);
      parent = parent.parentId ? r.entries.get(parent.parentId) : undefined;
    }
  }
  async directories(owner, id, hooks = {}) {
    const r = this.owned(owner, id);
    this.guard(r, () => hooks.authorize?.());
    if (r.busy) throw Error("DOWNLOAD_BUSY");
    if (!r.confirmed) throw Error("DOWNLOAD_NOT_READY");
    if (
      hooks.entryId !== undefined &&
      r.entries.get(hooks.entryId)?.kind !== "directory"
    )
      throw Error("FILE_DIRECTORY_ENTRY_INVALID");
    r.busy = true;
    try {
      for (const e of [...r.entries.values()]
        .filter(
          (e) =>
            e.kind === "directory" &&
            (hooks.entryId === undefined || e.id === hooks.entryId),
        )
        .sort((a, b) => a.names.length - b.names.length)) {
        const authorize = () => hooks.authorize?.(e.id);
        this.guard(r, authorize);
        if (e.action === "skip") {
          e.result = { state: "skipped" };
          continue;
        }
        if (e.binding) throw Error("DOWNLOAD_BUSY");
        if (e.result?.state === "unknown") {
          if (hooks.stopOnError) throw Error("FILE_DIRECTORY_RESULT_UNKNOWN");
          continue;
        }
        let creating = false,
          creationSucceeded = false;
        try {
          await this.parentsUnchanged(r, e, authorize);
          await hooks.audit?.("local_directory.entry-started", {
            entryId: e.id,
            relativePath: e.names.join("/"),
            action: e.action,
          });
          this.guard(r, authorize);
          const current = await stat(e.path);
          this.guard(r, authorize);
          if (e.directoryIdentity) {
            if (
              !current ||
              !current.isDirectory() ||
              current.isSymbolicLink() ||
              identity(current) !== e.directoryIdentity
            )
              throw Error("DOWNLOAD_TARGET_CHANGED");
            e.result = {
              state: e.result?.state === "created" ? "created" : "merged",
            };
          } else {
            if (current) throw Error("DOWNLOAD_TARGET_CHANGED");
            this.guard(r, authorize);
            creating = true;
            await fs.mkdir(e.path);
            creationSucceeded = true;
            this.guard(r, authorize);
            const created = await fs.lstat(e.path);
            if (!created.isDirectory() || created.isSymbolicLink())
              throw Error("DOWNLOAD_TARGET_CHANGED");
            e.directoryIdentity = identity(created);
            e.result = { state: "created" };
          }
          this.guard(r, authorize);
          await hooks.audit?.("local_directory.entry-completed", {
            entryId: e.id,
            relativePath: e.names.join("/"),
            result: e.result,
          });
          this.guard(r, authorize);
        } catch (error) {
          e.result = {
            state:
              creationSucceeded ||
              (creating &&
                ![
                  "EEXIST",
                  "EACCES",
                  "EPERM",
                  "ENOENT",
                  "ENOSPC",
                  "EROFS",
                ].includes(error.code))
                ? "unknown"
                : "failed",
            error: errorCode(error),
          };
          if (hooks.stopOnError) throw error;
        }
      }
      return [...r.entries.values()]
        .filter(
          (e) =>
            e.kind === "directory" &&
            (hooks.entryId === undefined || e.id === hooks.entryId),
        )
        .map((e) => ({ id: e.id, path: e.path, ...e.result }));
    } finally {
      r.busy = false;
    }
  }
  async file(owner, id, entryId, spec, authorize) {
    const r = this.owned(owner, id),
      e = r.entries.get(entryId);
    this.guard(r, authorize);
    if (r.busy || e?.binding) throw Error("DOWNLOAD_BUSY");
    if (
      !r.confirmed ||
      !e ||
      e.kind !== "file" ||
      e.action === "skip" ||
      e.status === "blocked" ||
      e.result?.state === "completed" ||
      spec?.size !== e.size
    )
      throw Error("DOWNLOAD_NOT_READY");
    e.binding = true;
    try {
      await this.parentsUnchanged(r, e, authorize);
      if (e.child) {
        let previous;
        try {
          previous = this.sink.owned(owner, e.child);
        } catch (error) {
          if (error.message !== "DOWNLOAD_NOT_FOUND") throw error;
        }
        if (previous) throw Error("DOWNLOAD_CLEANUP_PENDING");
      }
      const parent = e.parentId ? r.entries.get(e.parentId) : undefined;
      const view = await this.sink.choose(
        owner,
        { ...spec, name: e.name },
        async () => {
          await this.parentsUnchanged(r, e, authorize);
          return e.path;
        },
        {
          value: e.snapshot,
          parent: {
            path: parent?.path ?? r.path,
            identity: parent?.directoryIdentity ?? r.identity,
          },
        },
        () => this.guard(r, authorize),
      );
      e.child = view.id;
      e.sha256 = spec.sha256;
      try {
        this.guard(r, authorize);
      } catch (error) {
        await this.sink.cancel(owner, view.id);
        this.sink.forget(owner, view.id);
        throw error;
      }
      return view;
    } finally {
      e.binding = false;
    }
  }
  complete(owner, id, entryId) {
    const r = this.owned(owner, id),
      e = r.entries.get(entryId);
    if (!e?.child) throw Error("DOWNLOAD_NOT_FOUND");
    const record = this.sink.owned(owner, e.child),
      view = this.sink.view(record);
    if (
      view.state !== "completed" ||
      view.sha256 !== e.sha256 ||
      view.writtenBytes !== e.size
    )
      throw Error("DOWNLOAD_RESULT_UNVERIFIED");
    this.sink.forget(owner, e.child);
    e.result = { state: "completed" };
    e.completed = view;
    return view;
  }
  show(owner, id, entryId) {
    const r = this.owned(owner, id),
      e = r.entries.get(entryId);
    if (!["completed", "created", "merged"].includes(e?.result?.state))
      throw Error("DOWNLOAD_NOT_READY");
    return e.path;
  }
  async cancel(owner, id) {
    const r = this.owned(owner, id);
    r.cancelled = true;
    for (const e of r.entries.values())
      if (e.child) {
        try {
          await this.sink.cancel(owner, e.child);
        } catch (error) {
          if (error.message !== "DOWNLOAD_NOT_FOUND")
            e.error = errorCode(error);
        }
      }
    return this.view(r);
  }
  forget(owner, id) {
    const r = this.owned(owner, id);
    if (r.busy) throw Error("DOWNLOAD_BUSY");
    for (const e of r.entries.values()) {
      if (e.binding) throw Error("DOWNLOAD_BUSY");
      if (e.result?.state === "unknown") throw Error("DOWNLOAD_NOT_READY");
      if (e.child) {
        try {
          const child = this.sink.owned(owner, e.child);
          if (
            child.pending ||
            child.view.temporaryPath ||
            !["completed", "cancelled"].includes(child.view.state)
          )
            throw Error("DOWNLOAD_NOT_READY");
        } catch (error) {
          if (error.message !== "DOWNLOAD_NOT_FOUND") throw error;
        }
      }
    }
    for (const e of r.entries.values())
      if (e.child) {
        try {
          this.sink.forget(owner, e.child);
        } catch (error) {
          if (error.message !== "DOWNLOAD_NOT_FOUND") throw error;
        }
      }
    r.cancelled = true;
    this.roots.delete(id);
    return null;
  }
  async reset(owner) {
    for (const r of [...this.roots.values()].filter((r) => r.owner === owner)) {
      await this.cancel(owner, r.id);
      this.roots.delete(r.id);
    }
  }
}
module.exports = { DownloadDirectoryTargets, validName };
