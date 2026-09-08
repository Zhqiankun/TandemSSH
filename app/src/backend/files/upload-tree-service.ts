import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
  type UploadManifest,
} from "../../types/file-upload.js";
import {
  UPLOAD_TREE_MAX_ENTRIES,
  type UploadTreeEntry,
  type UploadTreePreview,
  type UploadTreeAction,
  type PrepareUploadTree,
} from "../../types/upload-tree.js";
import {
  uploadDirectoryAttributes,
  type UploadActor,
  type UploadPorts,
  type UploadService,
  type UploadConstraint,
  type UploadTarget,
} from "./upload-service.js";
import type { RemoteFileStat } from "./ports.js";
const lifetime = 30 * 60 * 1000;
const nameValid = (name: string) =>
  !!name &&
  name !== "." &&
  name !== ".." &&
  !/[\\/\x00-\x1f\x7f]/.test(name) &&
  Buffer.byteLength(name, "utf8") <= 255;
const errorCode = (e: unknown) =>
  e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
    ? e.message
    : "UPLOAD_FAILED";
export const uploadTreeSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    path: z
      .string()
      .startsWith("/")
      .max(4096)
      .refine((p) => !/[\x00-\x1f\x7f]/.test(p)),
    entries: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            parentId: z.string().min(1).max(128).optional(),
            name: z.string().max(1024),
            kind: z.enum(["file", "directory"]),
            size: z
              .number()
              .int()
              .min(0)
              .max(UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS),
            lastModified: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(UPLOAD_TREE_MAX_ENTRIES),
  })
  .strict();
interface TreeEntry {
  view: UploadTreeEntry;
  names: string[];
  directory?: string;
  baseline?: { stat: RemoteFileStat; sha256: string };
}
interface Tree {
  owner: string;
  targetKey: string;
  peer?: string;
  rootSignature: string;
  view: UploadTreePreview;
  entries: Map<string, TreeEntry>;
  busy: boolean;
  cancelled: boolean;
}
export class UploadTreeService {
  private readonly records = new Map<string, Tree>();
  private preparing = new Map<string, number>();
  private stopped = false;
  private readonly timer = setInterval(() => this.prune(), 60000);
  constructor(
    private readonly ports: UploadPorts,
    private readonly uploads: UploadService,
  ) {
    this.timer.unref?.();
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const r of this.records.values()) r.cancelled = true;
    this.records.clear();
  }
  private prune() {
    for (const [id, r] of this.records)
      if (!r.busy && r.view.expiresAt < Date.now()) {
        r.cancelled = true;
        this.records.delete(id);
      }
  }
  private owned(actor: UploadActor, id: string) {
    this.prune();
    const r = this.records.get(id);
    if (!r || r.owner !== actor.userId) throw Error("UPLOAD_NOT_FOUND");
    return r;
  }
  private alive(actor: UploadActor, r?: Tree) {
    if (this.stopped || actor.signal?.aborted || r?.cancelled)
      throw Error("UPLOAD_CANCELLED");
    if (r && r.view.expiresAt < Date.now()) throw Error("UPLOAD_EXPIRED");
    if (r) r.view.expiresAt = Date.now() + lifetime;
  }
  get(actor: UploadActor, id: string) {
    return structuredClone(this.owned(actor, id).view);
  }
  touch(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    return { id, expiresAt: r.view.expiresAt };
  }
  private async target(
    actor: UploadActor,
    r: Tree,
    sessionId = r.view.sessionId,
  ) {
    this.alive(actor, r);
    const t = await this.ports.target(actor.userId, sessionId);
    if (t.key !== r.targetKey || t.acceptedHostKey !== r.peer)
      throw Error("UPLOAD_HOST_IDENTITY_CHANGED");
    return t;
  }
  private async root(actor: UploadActor, r: Tree, t: UploadTarget) {
    this.alive(actor, r);
    t.check("write", r.view.path, r.view.canonicalRoot);
    if (
      (await t.io.resolve(r.view.path)) !== r.view.canonicalRoot ||
      uploadDirectoryAttributes(await t.io.stat(r.view.canonicalRoot)) !==
        r.rootSignature
    )
      throw Error("FILE_TARGET_CHANGED");
    this.alive(actor, r);
  }
  private async parents(
    actor: UploadActor,
    r: Tree,
    e: TreeEntry,
    t: UploadTarget,
    created: boolean,
  ) {
    await this.root(actor, r, t);
    let parent = e.view.parentId ? r.entries.get(e.view.parentId) : undefined;
    while (parent) {
      if (
        created &&
        !["created", "merged"].includes(parent.view.result?.state ?? "")
      )
        throw Error("UPLOAD_TREE_PARENT_UNAVAILABLE");
      if (!parent.directory) throw Error("UPLOAD_TREE_PARENT_UNAVAILABLE");
      t.check("write", parent.view.path, parent.view.path);
      if (
        (await t.io.resolve(parent.view.path)) !== parent.view.path ||
        uploadDirectoryAttributes(await t.io.stat(parent.view.path)) !==
          parent.directory
      )
        throw Error("FILE_TARGET_CHANGED");
      this.alive(actor, r);
      parent = parent.view.parentId
        ? r.entries.get(parent.view.parentId)
        : undefined;
    }
  }
  async preview(actor: UploadActor, input: PrepareUploadTree) {
    this.prune();
    this.alive(actor);
    const p = uploadTreeSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(p), "utf8") > 2 * 1024 * 1024)
      throw Error("UPLOAD_TREE_LIMIT");
    const active = [...this.preparing.values()].reduce((a, b) => a + b, 0),
      own = this.preparing.get(actor.userId) ?? 0;
    if (
      active >= 2 ||
      this.records.size + active >= 16 ||
      [...this.records.values()].filter((r) => r.owner === actor.userId)
        .length +
        own >=
        4
    )
      throw Error("UPLOAD_TREE_LIMIT");
    this.preparing.set(actor.userId, own + 1);
    let release: (() => void) | undefined;
    try {
      const t = await this.ports.target(actor.userId, p.sessionId);
      release = t.retain?.();
      t.check("write", p.path, p.path);
      const canonicalRoot = await t.io.resolve(p.path),
        rootStat = await t.io.stat(canonicalRoot);
      this.alive(actor);
      if (
        rootStat.kind !== "directory" ||
        !posix.isAbsolute(canonicalRoot) ||
        posix.normalize(canonicalRoot) !== canonicalRoot
      )
        throw Error("FILE_NOT_DIRECTORY");
      t.check("write", p.path, canonicalRoot);
      const view: UploadTreePreview = {
        id: randomUUID(),
        revision: randomUUID(),
        sessionId: p.sessionId,
        path: p.path,
        canonicalRoot,
        hostIdentity: t.hostScope?.identity,
        state: "preview",
        entries: [],
        expiresAt: Date.now() + lifetime,
      };
      const r: Tree = {
        owner: actor.userId,
        targetKey: t.key,
        peer: t.acceptedHostKey,
        rootSignature: uploadDirectoryAttributes(rootStat),
        view,
        entries: new Map(),
        busy: false,
        cancelled: false,
      };
      for (const e of p.entries) {
        if (r.entries.has(e.id)) throw Error("UPLOAD_REQUEST_INVALID");
        r.entries.set(e.id, {
          view: { ...e, path: "", relativePath: "", status: "new" },
          names: [],
        });
      }
      const activeIds = new Set<string>();
      const build = (entry: TreeEntry): void => {
        if (entry.names.length) return;
        if (activeIds.has(entry.view.id) || activeIds.size > 64)
          throw Error("UPLOAD_REQUEST_INVALID");
        activeIds.add(entry.view.id);
        const parent = entry.view.parentId
          ? r.entries.get(entry.view.parentId)
          : undefined;
        if (
          entry.view.parentId &&
          (!parent || parent.view.kind !== "directory")
        )
          throw Error("UPLOAD_REQUEST_INVALID");
        if (parent) build(parent);
        entry.names = [...(parent?.names ?? []), entry.view.name];
        if (entry.names.length > 65) throw Error("UPLOAD_TREE_LIMIT");
        entry.view.relativePath = entry.names.join("/");
        entry.view.path =
          canonicalRoot.replace(/\/$/, "") + "/" + entry.view.relativePath;
        if (
          entry.names.some((name) => !nameValid(name)) ||
          entry.view.path.length > 4096
        ) {
          entry.view.status = "blocked";
          entry.view.error = "FILE_PATH_INVALID";
        }
        activeIds.delete(entry.view.id);
      };
      for (const e of r.entries.values()) build(e);
      const paths = new Map<string, TreeEntry>();
      for (const e of r.entries.values()) {
        const existing = paths.get(e.view.path);
        if (existing) {
          existing.view.status = e.view.status = "blocked";
          existing.view.error = e.view.error = "UPLOAD_TREE_DUPLICATE_TARGET";
        } else paths.set(e.view.path, e);
      }
      for (const e of [...r.entries.values()].sort(
        (a, b) => a.names.length - b.names.length,
      )) {
        this.alive(actor, r);
        if (e.view.status === "blocked") continue;
        const parent = e.view.parentId
          ? r.entries.get(e.view.parentId)
          : undefined;
        if (parent?.view.status === "blocked") {
          e.view.status = "blocked";
          e.view.error = "UPLOAD_TREE_PARENT_UNAVAILABLE";
          continue;
        }
        if (parent?.view.status === "new") continue;
        try {
          await this.parents(actor, r, e, t, false);
          t.check("write", e.view.path, e.view.path);
          let current: RemoteFileStat;
          try {
            current = await t.io.stat(e.view.path);
          } catch (error) {
            if (errorCode(error) === "FILE_NOT_FOUND") continue;
            throw error;
          }
          if (current.kind === "symlink" || current.kind !== e.view.kind)
            throw Error("UPLOAD_TREE_TYPE_CONFLICT");
          if ((await t.io.resolve(e.view.path)) !== e.view.path)
            throw Error("FILE_TARGET_CHANGED");
          if (e.view.kind === "directory") {
            e.directory = uploadDirectoryAttributes(current);
            e.view.status = "directory";
          } else {
            const inspected = await t.io.inspectFile(e.view.path, () => {
              this.alive(actor, r);
              t.check("write", e.view.path, e.view.path);
            });
            await this.parents(actor, r, e, t, false);
            e.baseline = { stat: inspected.stat, sha256: inspected.sha256 };
            e.view.status = "conflict";
            current = inspected.stat;
          }
          e.view.existing = {
            size: current.size,
            mtime: current.mtime,
            mode: current.mode & 0o7777,
          };
        } catch (error) {
          this.alive(actor, r);
          e.view.status = "blocked";
          e.view.error = errorCode(error);
        }
      }
      await this.root(actor, r, t);
      view.entries = [...r.entries.values()].map((e) => e.view);
      await this.ports.audit(actor.userId, "upload.tree.prepared", {
        id: view.id,
        path: view.path,
        canonicalRoot,
        entries: view.entries.length,
      });
      this.alive(actor, r);
      this.records.set(view.id, r);
      return structuredClone(view);
    } finally {
      release?.();
      const count = (this.preparing.get(actor.userId) ?? 1) - 1;
      if (count) this.preparing.set(actor.userId, count);
      else this.preparing.delete(actor.userId);
    }
  }
  async confirm(
    actor: UploadActor,
    id: string,
    revision: string,
    raw: Array<{ id: string; action: UploadTreeAction }>,
  ) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (r.busy || r.view.state !== "preview" || r.view.revision !== revision)
      throw Error("UPLOAD_STATE_INVALID");
    const decisions = z
        .array(
          z
            .object({
              id: z.string(),
              action: z.enum(["create", "merge", "overwrite", "skip"]),
            })
            .strict(),
        )
        .max(UPLOAD_TREE_MAX_ENTRIES)
        .parse(raw),
      choices = new Map(decisions.map((d) => [d.id, d.action]));
    if (
      choices.size !== r.entries.size ||
      decisions.length !== r.entries.size ||
      [...choices.keys()].some((id) => !r.entries.has(id))
    )
      throw Error("UPLOAD_REQUEST_INVALID");
    const actions = new Map<string, UploadTreeAction>();
    for (const e of [...r.entries.values()].sort(
      (a, b) => a.names.length - b.names.length,
    )) {
      const action =
        e.view.parentId && actions.get(e.view.parentId) === "skip"
          ? "skip"
          : choices.get(e.view.id)!;
      if (
        action !== "skip" &&
        (e.view.status === "blocked" ||
          (e.view.status === "new"
            ? action !== "create"
            : e.view.status === "directory"
              ? action !== "merge"
              : action !== "overwrite"))
      )
        throw Error("UPLOAD_OVERWRITE_REQUIRED");
      actions.set(e.view.id, action);
    }
    r.busy = true;
    try {
      await this.ports.audit(actor.userId, "upload.tree.confirmed", {
        id,
        revision,
        actions: [...actions].map(([id, action]) => ({ id, action })),
      });
      this.alive(actor, r);
      for (const e of r.entries.values())
        e.view.action = actions.get(e.view.id);
      r.view.state = "confirmed";
      return structuredClone(r.view);
    } finally {
      r.busy = false;
    }
  }
  async directories(
    actor: UploadActor,
    id: string,
    takeover = false,
    entryId?: string,
  ) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (r.busy || r.view.state !== "confirmed")
      throw Error("UPLOAD_STATE_INVALID");
    if (
      entryId !== undefined &&
      r.entries.get(entryId)?.view.kind !== "directory"
    )
      throw Error("FILE_DIRECTORY_ENTRY_INVALID");
    r.busy = true;
    const releases: Array<() => void> = [];
    try {
      const directoryEntries = [...r.entries.values()].filter(
        (e) =>
          e.view.kind === "directory" &&
          (entryId === undefined || e.view.id === entryId),
      );
      if (directoryEntries.every((e) => e.view.action === "skip")) {
        for (const e of directoryEntries) e.view.result = { state: "skipped" };
        return directoryEntries.map((e) => ({
          id: e.view.id,
          path: e.view.path,
          ...e.view.result!,
        }));
      }
      const t = await this.target(actor, r);
      if (!t.io.mkdir) throw Error("FILE_DIRECTORY_WRITE_UNAVAILABLE");
      releases.push(t.retain?.() ?? (() => {}));
      releases.push(this.ports.beginWrite(actor.userId, t, takeover));
      for (const e of [...r.entries.values()]
        .filter(
          (e) =>
            e.view.kind === "directory" &&
            (entryId === undefined || e.view.id === entryId),
        )
        .sort((a, b) => a.names.length - b.names.length)) {
        this.alive(actor, r);
        if (e.view.action === "skip") {
          e.view.result = { state: "skipped" };
          continue;
        }
        if (e.view.result?.state === "unknown") continue;
        let unlock: (() => void) | undefined,
          sent = false,
          created = false;
        try {
          unlock = this.ports.locks.acquire(t.key + "\0" + e.view.path);
          await this.parents(actor, r, e, t, true);
          const guard = () => {
            this.alive(actor, r);
            t.check("write", e.view.path, e.view.path);
          };
          guard();
          let current: RemoteFileStat | undefined;
          try {
            current = await t.io.stat(e.view.path);
          } catch (error) {
            if (errorCode(error) !== "FILE_NOT_FOUND") throw error;
          }
          if (e.directory) {
            if (
              !current ||
              uploadDirectoryAttributes(current) !== e.directory ||
              (await t.io.resolve(e.view.path)) !== e.view.path
            )
              throw Error("FILE_TARGET_CHANGED");
            e.view.result = {
              state: e.view.result?.state === "created" ? "created" : "merged",
              mode: current.mode & 0o7777,
            };
          } else {
            if (current) throw Error("FILE_CONFLICT");
            await this.ports.audit(actor.userId, "upload.directory.create", {
              treeId: id,
              entryId: e.view.id,
              path: e.view.path,
              mode: 0o700,
            });
            guard();
            sent = true;
            await t.io.mkdir(e.view.path, 0o700, guard);
            created = true;
            const actual = await t.io.stat(e.view.path);
            if (
              actual.kind !== "directory" ||
              (await t.io.resolve(e.view.path)) !== e.view.path
            )
              throw Error("FILE_TARGET_CHANGED");
            guard();
            await this.ports.audit(actor.userId, "upload.directory.created", {
              treeId: id,
              entryId: e.view.id,
              path: e.view.path,
              mode: actual.mode & 0o7777,
            });
            e.directory = uploadDirectoryAttributes(actual);
            e.view.result = { state: "created", mode: actual.mode & 0o7777 };
          }
        } catch (error) {
          const known = [
            "FILE_PERMISSION_DENIED",
            "FILE_NOT_FOUND",
            "FILE_ALREADY_EXISTS",
          ];
          e.view.result = {
            state:
              created || (sent && !known.includes(errorCode(error)))
                ? "unknown"
                : "failed",
            error: errorCode(error),
          };
          await this.ports
            .audit(actor.userId, "upload.directory.result", {
              treeId: id,
              entryId: e.view.id,
              path: e.view.path,
              ...e.view.result,
            })
            .catch(() => {});
        } finally {
          unlock?.();
        }
      }
      return r.view.entries
        .filter(
          (e) =>
            e.kind === "directory" &&
            (entryId === undefined || e.id === entryId),
        )
        .map((e) => ({ id: e.id, path: e.path, ...e.result! }));
    } finally {
      releases.reverse().forEach((fn) => fn());
      r.busy = false;
    }
  }
  async prepareEntry(
    actor: UploadActor,
    id: string,
    entryId: string,
    sessionId: string,
    requestId: string,
    manifest: UploadManifest,
  ) {
    const r = this.owned(actor, id),
      e = r.entries.get(entryId);
    this.alive(actor, r);
    if (
      r.busy ||
      r.view.state !== "confirmed" ||
      !e ||
      e.view.kind !== "file" ||
      e.view.action === "skip" ||
      e.view.size !== manifest.size ||
      e.view.lastModified !== manifest.lastModified
    )
      throw Error("UPLOAD_TREE_ENTRY_UNAVAILABLE");
    const t = await this.target(actor, r, sessionId);
    await this.parents(actor, r, e, t, true);
    const parents: UploadConstraint["parents"] = [
      { path: r.view.canonicalRoot, signature: r.rootSignature },
    ];
    let parent = e.view.parentId ? r.entries.get(e.view.parentId) : undefined;
    while (parent) {
      parents.push({ path: parent.view.path, signature: parent.directory! });
      parent = parent.view.parentId
        ? r.entries.get(parent.view.parentId)
        : undefined;
    }
    return this.uploads.prepare(
      actor,
      { sessionId, requestId, path: e.view.path, manifest },
      {
        targetKey: r.targetKey,
        acceptedHostKey: r.peer,
        canonicalPath: e.view.path,
        baseline: e.baseline,
        parents,
      },
    );
  }
  cancel(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    r.cancelled = true;
    r.view.state = "cancelled";
    return structuredClone(r.view);
  }
  forget(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    if (r.busy || r.view.entries.some((e) => e.result?.state === "unknown"))
      throw Error("UPLOAD_CLEANUP_PENDING");
    r.cancelled = true;
    this.records.delete(id);
    return { id };
  }
}
