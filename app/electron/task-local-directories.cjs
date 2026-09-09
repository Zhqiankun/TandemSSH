const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const {
  DownloadDirectoryTargets,
} = require("./download-directory-targets.cjs");
const { openTaskUploadSource } = require("./task-upload-access.cjs");
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
/** Task-scoped directory capabilities. Paths enter only from a native picker. */
class TaskLocalDirectories {
  constructor(sources, sink) {
    this.sources = sources;
    this.sink = sink;
    this.targets = new DownloadDirectoryTargets(sink);
    this.records = new Map();
    this.selecting = 0;
    this.selectingOwners = new Map();
    this.closed = false;
  }
  has(id) {
    return this.records.has(id);
  }
  owned(id) {
    const r = this.records.get(id);
    if (!r) throw Error("FILE_LOCAL_GRANT_NOT_FOUND");
    return r;
  }
  guard(r, authorize) {
    if (this.closed || r?.revoked || (r && this.records.get(r.id) !== r))
      throw Error("FILE_LOCAL_GRANT_REVOKED");
    if (typeof authorize !== "function")
      throw Error("FILE_DIRECTORY_AUTHORIZATION_REQUIRED");
    authorize();
  }
  view(id) {
    const r = this.owned(id);
    return {
      id: r.id,
      version: r.version,
      kind: "directory",
      direction: r.direction,
      name: r.name,
      path: r.path,
      size: r.source?.bytes,
      entries: r.source?.entries.length,
      excluded: r.source?.excluded,
      busy: r.pending > 0 || r.uploads.size > 0 || r.downloads.size > 0,
      consumed: false,
    };
  }
  async unchanged(r, guard) {
    guard();
    const stat = await fs.lstat(r.path);
    guard();
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      identity(stat) !== r.identity ||
      (await fs.realpath(r.path)) !== r.path
    )
      throw Error("FILE_LOCAL_DIRECTORY_CHANGED");
    guard();
  }
  async select(direction, owner, selected, authorize) {
    this.guard(undefined, authorize);
    if (
      !["upload", "download"].includes(direction) ||
      typeof selected !== "string" ||
      !path.isAbsolute(selected) ||
      /[\x00-\x1f\x7f]/.test(selected)
    )
      throw Error("FILE_LOCAL_SELECTION_INVALID");
    const own = this.selectingOwners.get(owner) ?? 0;
    if (
      this.selecting >= 2 ||
      this.records.size + this.selecting >= 8 ||
      [...this.records.values()].filter((r) => r.owner === owner).length +
        own >=
        4
    )
      throw Error("FILE_LOCAL_GRANT_LIMIT");
    this.selecting++;
    this.selectingOwners.set(owner, own + 1);
    let source;
    const guard = () => this.guard(undefined, authorize);
    try {
      const root = await fs.realpath(selected),
        stat = await fs.lstat(root);
      guard();
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("FILE_LOCAL_DIRECTORY_REQUIRED");
      if (direction === "upload") {
        source = await this.sources.select(owner, [root], guard);
        if (
          source.entries.filter((e) => !e.parentId).length !== 1 ||
          source.entries[0]?.kind !== "directory"
        )
          throw Error("FILE_LOCAL_DIRECTORY_REQUIRED");
      }
      guard();
      const current = await fs.lstat(root);
      guard();
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        identity(stat) !== identity(current)
      )
        throw Error("FILE_LOCAL_DIRECTORY_CHANGED");
      const r = {
        id: randomUUID(),
        version: randomUUID(),
        owner,
        direction,
        path: root,
        name: path.basename(root) || "root",
        identity: identity(stat),
        source,
        revoked: false,
        pending: 0,
        uploads: new Set(),
        downloads: new Set(),
        plans: new Set(),
      };
      this.records.set(r.id, r);
      return this.view(r.id);
    } catch (error) {
      if (source) this.sources.forget(owner, source.id);
      throw error;
    } finally {
      this.selecting--;
      const left = (this.selectingOwners.get(owner) ?? 1) - 1;
      if (left) this.selectingOwners.set(owner, left);
      else this.selectingOwners.delete(owner);
    }
  }
  access(id, authorize, signal, { allowOverwrite = false } = {}) {
    const r = this.owned(id),
      guard = () => {
        if (!signal || typeof signal.aborted !== "boolean")
          throw Error("FILE_DIRECTORY_AUTHORIZATION_REQUIRED");
        if (signal.aborted) throw Error("FILE_TRANSFER_CANCELLED");
        this.guard(r, authorize);
      };
    guard();
    const plan = (id) => {
      if (!r.plans.has(id)) throw Error("FILE_LOCAL_GRANT_REQUIRED");
      return this.targets.owned(r.owner, id);
    };
    const busy = async (work) => {
      guard();
      if (r.pending >= 2) throw Error("FILE_LOCAL_GRANT_BUSY");
      r.pending++;
      try {
        return await work();
      } finally {
        r.pending--;
      }
    };
    const direction = (expected) => {
      guard();
      if (r.direction !== expected)
        throw Error("FILE_LOCAL_DIRECTORY_REQUIRED");
    };
    return {
      uploadCheckpoint: () => {
        direction("upload");
        if (r.pending || r.uploads.size) throw Error("FILE_LOCAL_GRANT_BUSY");
        return this.sources.checkpoint(r.owner, r.source.id, guard);
      },
      restoreUpload: (checkpoint) => {
        direction("upload");
        if (r.pending || r.uploads.size) throw Error("FILE_LOCAL_GRANT_BUSY");
        r.source = this.sources.restore(
          r.owner,
          r.source.id,
          checkpoint,
          guard,
        );
      },
      uploadEntries: () => {
        direction("upload");
        return r.source.entries.map(
          ({
            id,
            parentId,
            name,
            relativePath,
            kind,
            size,
            lastModified,
            error,
          }) => ({
            id,
            parentId,
            name,
            relativePath,
            kind,
            size,
            lastModified,
            error,
          }),
        );
      },
      uploadFile: async (entryId) => {
        direction("upload");
        const entry = r.source.entries.find((e) => e.id === entryId);
        if (!entry || entry.kind !== "file" || entry.error)
          throw Error("FILE_LOCAL_GRANT_REQUIRED");
        if (r.uploads.has(entryId) || r.uploads.size >= 4)
          throw Error("FILE_LOCAL_GRANT_BUSY");
        r.uploads.add(entryId);
        return openTaskUploadSource(
          this.sources,
          { owner: r.owner, selectionId: r.source.id, entry },
          guard,
          () => r.uploads.delete(entryId),
        );
      },
      downloadCheckpoint: (previewId) =>
        busy(async () => {
          direction("download");
          plan(previewId);
          if (r.downloads.size) throw Error("FILE_LOCAL_GRANT_BUSY");
          return this.targets.checkpoint(r.owner, previewId, guard);
        }),
      restoreDownload: (checkpoint) =>
        busy(async () => {
          direction("download");
          await this.unchanged(r, guard);
          const chosen = await this.targets.choose(
            r.owner,
            async () => r.path,
            guard,
          );
          let current = chosen.id;
          try {
            const restored = await this.targets.restore(
              r.owner,
              chosen.id,
              checkpoint,
              guard,
            );
            current = restored.id;
            guard();
            r.plans.add(current);
            return restored;
          } catch (error) {
            this.targets.forget(r.owner, current);
            throw error;
          }
        }),
      previewDownload: (entries) =>
        busy(async () => {
          direction("download");
          await this.unchanged(r, guard);
          const chosen = await this.targets.choose(
            r.owner,
            async () => r.path,
            guard,
          );
          try {
            await this.unchanged(r, guard);
            const view = await this.targets.preview(
              r.owner,
              chosen.id,
              entries,
              guard,
            );
            guard();
            r.plans.add(chosen.id);
            return view;
          } catch (error) {
            this.targets.forget(r.owner, chosen.id);
            throw error;
          }
        }),
      confirmDownload: (previewId, revision, decisions) => {
        direction("download");
        plan(previewId);
        if (!allowOverwrite && decisions.some((d) => d.action === "overwrite"))
          throw Error("FILE_LOCAL_OVERWRITE_REQUIRED");
        return this.targets.confirm(
          r.owner,
          previewId,
          revision,
          decisions,
          guard,
        );
      },
      createDownloadDirectories: (previewId, audit, entryGuard, entryId) =>
        busy(async () => {
          direction("download");
          plan(previewId);
          if (typeof audit !== "function" || typeof entryGuard !== "function")
            throw Error("FILE_DIRECTORY_AUTHORIZATION_REQUIRED");
          await this.unchanged(r, guard);
          return this.targets.directories(r.owner, previewId, {
            authorize: (entryId) => {
              guard();
              entryGuard(entryId);
            },
            audit: async (type, data) => {
              guard();
              await audit(type, data);
              guard();
            },
            stopOnError: true,
            entryId,
          });
        }),
      downloadFile: async (previewId, entryId, source) => {
        direction("download");
        const p = plan(previewId),
          entry = p.entries.get(entryId),
          key = previewId + ":" + entryId;
        if (
          !entry ||
          entry.kind !== "file" ||
          r.downloads.has(key) ||
          r.downloads.size >= 4
        )
          throw Error("FILE_LOCAL_GRANT_BUSY");
        r.downloads.add(key);
        let local,
          completed,
          closed = false;
        const fileGuard = () => {
          guard();
          if (closed) throw Error("FILE_LOCAL_ACCESS_CLOSED");
        };
        try {
          await this.unchanged(r, fileGuard);
          local = await this.targets.file(
            r.owner,
            previewId,
            entryId,
            {
              name: source.name,
              size: source.size,
              sha256: source.sha256,
              hashes: source.hashes,
            },
            fileGuard,
          );
        } catch (error) {
          r.downloads.delete(key);
          throw error;
        }
        return {
          snapshot: () =>
            completed
              ? structuredClone(completed)
              : this.sink.view(this.sink.owned(r.owner, local.id)),
          start: (overwrite) => {
            fileGuard();
            if (
              overwrite !== (entry.action === "overwrite") ||
              (overwrite && !allowOverwrite)
            )
              throw Error("FILE_DIRECTORY_DECISION_CHANGED");
            return this.sink.start(r.owner, local.id, overwrite);
          },
          append: (offset, bytes) => {
            fileGuard();
            return this.sink.append(r.owner, local.id, offset, bytes);
          },
          finish: async () => {
            fileGuard();
            const result = await this.sink.finish(r.owner, local.id);
            if (result.state === "completed")
              completed = this.targets.complete(r.owner, previewId, entryId);
            return structuredClone(completed ?? result);
          },
          close: async () => {
            if (closed) return;
            closed = true;
            try {
              if (!completed) {
                const child = this.sink.owned(r.owner, local.id);
                await child.tail;
                if (child.handle) {
                  await child.handle.close();
                  child.handle = undefined;
                }
              }
            } finally {
              r.downloads.delete(key);
            }
          },
        };
      },
      downloadState: (previewId) => {
        const p = plan(previewId);
        return this.targets.view(p);
      },
    };
  }
  downloadState(id, previewId) {
    const r = this.owned(id);
    if (!r.plans.has(previewId)) throw Error("FILE_LOCAL_GRANT_REQUIRED");
    const plan = this.targets.owned(r.owner, previewId),
      transfers = [];
    for (const entry of plan.entries.values()) {
      let view = entry.completed;
      if (!view && entry.child) {
        try {
          view = this.sink.view(this.sink.owned(r.owner, entry.child));
        } catch (error) {
          if (error.message !== "DOWNLOAD_NOT_FOUND") throw error;
        }
      }
      if (view) transfers.push({ entryId: entry.id, transfer: view });
    }
    return { ...this.targets.view(plan), transfers };
  }
  async cancelPreview(id, previewId) {
    const r = this.owned(id);
    if (!r.plans.has(previewId)) throw Error("FILE_LOCAL_GRANT_REQUIRED");
    return this.targets.cancel(r.owner, previewId);
  }
  forgetPreview(id, previewId) {
    const r = this.owned(id);
    if (!r.plans.has(previewId)) throw Error("FILE_LOCAL_GRANT_REQUIRED");
    this.targets.forget(r.owner, previewId);
    r.plans.delete(previewId);
  }
  revoke(id) {
    this.owned(id).revoked = true;
  }
  async forget(id) {
    const r = this.owned(id);
    r.revoked = true;
    if (this.view(id).busy) throw Error("FILE_LOCAL_GRANT_BUSY");
    for (const p of [...r.plans]) {
      await this.targets.cancel(r.owner, p);
      this.targets.forget(r.owner, p);
      r.plans.delete(p);
    }
    if (r.source) this.sources.forget(r.owner, r.source.id);
    this.records.delete(id);
  }
  async dispose() {
    this.closed = true;
    for (const r of this.records.values()) r.revoked = true;
    for (const r of [...this.records.values()])
      if (!this.view(r.id).busy) await this.forget(r.id).catch(() => {});
  }
}
module.exports = { TaskLocalDirectories };
