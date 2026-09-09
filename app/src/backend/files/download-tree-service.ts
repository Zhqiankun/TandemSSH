import { randomUUID } from "node:crypto";
import {
  downloadTreeCheckpointSchema,
  type DownloadTreeCheckpoint,
} from "./download-tree-checkpoint.js";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_CHUNKS,
} from "../../types/file-download.js";
import { posix } from "node:path";
import { z } from "zod";
import {
  DOWNLOAD_TREE_MAX_DEPTH,
  DOWNLOAD_TREE_MAX_ENTRIES,
  type DownloadTreeEntry,
  type DownloadTreePreview,
  type ScanDownloadTree,
} from "../../types/download-tree.js";
import type { RemoteFileStat } from "./ports.js";
import type {
  DownloadActor,
  DownloadPorts,
  DownloadService,
  DownloadSourceConstraint,
} from "./download-service.js";
const idleMs = 30 * 60 * 1000;
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine((p) => !/[\x00-\x1f\x7f]/.test(p));
export const scanDownloadTreeSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    paths: z.array(pathSchema).min(1).max(DOWNLOAD_TREE_MAX_ENTRIES),
  })
  .strict();
interface TreeRecord {
  targetKey: string;
  peer?: string;
  directories: Map<string, RemoteFileStat>;
  owner: string;
  view: DownloadTreePreview;
  constraints: Map<string, DownloadSourceConstraint>;
}
const attributes = (s: RemoteFileStat) =>
  JSON.stringify([s.kind, s.size, s.mtime, s.mode, s.uid, s.gid]);
export class DownloadTreeService {
  private readonly records = new Map<string, TreeRecord>();
  private scanning = 0;
  private readonly scanningOwners = new Map<string, number>();
  private stopped = false;
  private readonly timer = setInterval(() => this.prune(), 60000);
  constructor(
    private readonly ports: DownloadPorts,
    private readonly downloads: DownloadService,
  ) {
    this.timer.unref?.();
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    this.records.clear();
  }
  private prune() {
    for (const [id, r] of this.records)
      if (r.view.expiresAt < Date.now()) this.records.delete(id);
  }
  private owned(actor: DownloadActor, id: string) {
    this.prune();
    if (this.stopped || actor.signal?.aborted)
      throw Error("DOWNLOAD_CANCELLED");
    const record = this.records.get(id);
    if (!record || record.owner !== actor.userId)
      throw Error("DOWNLOAD_NOT_FOUND");
    return record;
  }
  touch(actor: DownloadActor, id: string) {
    const r = this.owned(actor, id);
    r.view.expiresAt = Date.now() + idleMs;
    return { id: r.view.id, expiresAt: r.view.expiresAt };
  }
  get(actor: DownloadActor, id: string) {
    return structuredClone(this.owned(actor, id).view);
  }
  forget(actor: DownloadActor, id: string) {
    const record = this.owned(actor, id);
    this.records.delete(id);
    return { id: record.view.id };
  }
  private reserve(actor: DownloadActor) {
    if (
      this.scanning >= 2 ||
      this.records.size + this.scanning >= 16 ||
      [...this.records.values()].filter((r) => r.owner === actor.userId)
        .length +
        (this.scanningOwners.get(actor.userId) ?? 0) >=
        4
    )
      throw Error("DOWNLOAD_TREE_LIMIT");
    this.scanning++;
    this.scanningOwners.set(
      actor.userId,
      (this.scanningOwners.get(actor.userId) ?? 0) + 1,
    );
  }
  checkpoint(actor: DownloadActor, id: string): DownloadTreeCheckpoint {
    const r = this.owned(actor, id);
    if (!r.peer) throw Error("DOWNLOAD_HOST_IDENTITY_UNVERIFIED");
    return downloadTreeCheckpointSchema.parse({
      schemaVersion: 1,
      id,
      userId: r.owner,
      targetKey: r.targetKey,
      peer: r.peer,
      hostIdentity: r.view.hostIdentity,
      scannedAt: r.view.scannedAt,
      savedAt: Date.now(),
      entries: r.view.entries.map((view) => ({
        view,
        stat: view.error
          ? undefined
          : (r.constraints.get(view.id)?.stat ?? r.directories.get(view.id)),
      })),
    });
  }
  /** Restores fixed membership without rescanning or writing either endpoint. */
  async restore(actor: DownloadActor, raw: unknown, sessionId: string) {
    const c = downloadTreeCheckpointSchema.parse(raw);
    if (c.userId !== actor.userId) throw Error("DOWNLOAD_NOT_FOUND");
    z.string().min(1).max(256).parse(sessionId);
    this.prune();
    if (this.stopped || actor.signal?.aborted)
      throw Error("DOWNLOAD_CANCELLED");
    this.reserve(actor);
    let release: (() => void) | undefined;
    const started = Date.now();
    try {
      const t = await this.ports.target(actor.userId, sessionId);
      release = t.retain?.();
      const guard = () => {
        if (this.stopped || actor.signal?.aborted)
          throw Error("DOWNLOAD_CANCELLED");
        if (Date.now() - started > 5 * 60 * 1000)
          throw Error("DOWNLOAD_TREE_TIMEOUT");
      };
      guard();
      if (t.key !== c.targetKey || t.acceptedHostKey !== c.peer)
        throw Error("DOWNLOAD_HOST_IDENTITY_CHANGED");
      const constraints = new Map<string, DownloadSourceConstraint>(),
        directories = new Map<string, RemoteFileStat>();
      const view: DownloadTreePreview = {
        id: randomUUID(),
        sessionId,
        hostIdentity: c.hostIdentity,
        entries: c.entries.map((e) => e.view),
        files: 0,
        directories: 0,
        totalBytes: 0,
        skipped: 0,
        scannedAt: c.scannedAt,
        expiresAt: Date.now() + idleMs,
      };
      for (const e of c.entries) {
        guard();
        if (e.view.error) {
          view.skipped++;
          continue;
        }
        t.check("read", e.view.path, e.view.path);
        if ((await t.io.resolve(e.view.path)) !== e.view.path)
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        const actual = await t.io.stat(e.view.path),
          saved = e.stat!;
        const signature = (s: RemoteFileStat) =>
          s.kind === "directory"
            ? JSON.stringify([s.kind, s.mode, s.uid, s.gid])
            : attributes(s);
        if (signature(actual) !== signature(saved))
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        guard();
        if (e.view.kind === "file") {
          constraints.set(e.view.id, {
            key: c.targetKey,
            peer: c.peer,
            canonicalPath: e.view.path,
            stat: saved,
          });
          view.files++;
          view.totalBytes += e.view.size;
          if (!Number.isSafeInteger(view.totalBytes))
            throw Error("DOWNLOAD_TREE_LIMIT");
        } else {
          directories.set(e.view.id, saved);
          view.directories++;
        }
      }
      await this.ports.audit(actor.userId, "file.download.tree_restored", {
        id: view.id,
        checkpointId: c.id,
        entries: view.entries.length,
      });
      guard();
      view.expiresAt = Date.now() + idleMs;
      this.records.set(view.id, {
        owner: actor.userId,
        targetKey: c.targetKey,
        peer: c.peer,
        view,
        constraints,
        directories,
      });
      return structuredClone(view);
    } finally {
      release?.();
      this.scanning--;
      const count = (this.scanningOwners.get(actor.userId) ?? 1) - 1;
      if (count) this.scanningOwners.set(actor.userId, count);
      else this.scanningOwners.delete(actor.userId);
    }
  }
  async scan(
    actor: DownloadActor,
    raw: ScanDownloadTree,
  ): Promise<DownloadTreePreview> {
    this.prune();
    if (this.stopped || actor.signal?.aborted)
      throw Error("DOWNLOAD_CANCELLED");
    const input = scanDownloadTreeSchema.parse(raw);
    this.reserve(actor);
    let release: (() => void) | undefined;
    const started = Date.now();
    try {
      const target = await this.ports.target(actor.userId, input.sessionId);
      release = target.retain?.();
      if (!target.io.list) throw Error("FILE_INSPECTION_UNAVAILABLE");
      const guard = () => {
        if (this.stopped || actor.signal?.aborted)
          throw Error("DOWNLOAD_CANCELLED");
        if (Date.now() - started > 5 * 60 * 1000)
          throw Error("DOWNLOAD_TREE_TIMEOUT");
      };
      const view: DownloadTreePreview = {
        id: randomUUID(),
        sessionId: input.sessionId,
        hostIdentity: target.hostScope?.identity,
        entries: [],
        files: 0,
        directories: 0,
        totalBytes: 0,
        skipped: 0,
        scannedAt: started,
        expiresAt: started + idleMs,
      };
      const constraints = new Map<string, DownloadSourceConstraint>(),
        directories = new Map<string, RemoteFileStat>(),
        visited = new Set<string>();
      let metadataBytes = 0;
      const roots = [
        ...new Set(input.paths.map((p) => posix.normalize(p))),
      ].sort((a, b) => a.length - b.length || a.localeCompare(b));
      const selections: string[] = [],
        selected = new Set<string>();
      for (const candidate of roots) {
        let ancestor = candidate,
          covered = false;
        for (;;) {
          if (selected.has(ancestor)) {
            covered = true;
            break;
          }
          const parent = posix.dirname(ancestor);
          if (parent === ancestor) break;
          ancestor = parent;
        }
        if (!covered) {
          selections.push(candidate);
          selected.add(candidate);
        }
      }
      const append = (entry: DownloadTreeEntry) => {
        metadataBytes += Buffer.byteLength(JSON.stringify(entry), "utf8");
        if (
          view.entries.length >= DOWNLOAD_TREE_MAX_ENTRIES ||
          metadataBytes > 2 * 1024 * 1024
        )
          throw Error("DOWNLOAD_TREE_LIMIT");
        view.entries.push(entry);
      };
      const walk = async (
        requested: string,
        relativePath: string,
        parentId: string | undefined,
        depth: number,
        rootCanonical?: string,
      ): Promise<void> => {
        guard();
        if (
          depth > DOWNLOAD_TREE_MAX_DEPTH ||
          view.entries.length >= DOWNLOAD_TREE_MAX_ENTRIES
        )
          throw Error("DOWNLOAD_TREE_LIMIT");
        if (requested.length > 4096 || /[\x00-\x1f\x7f]/.test(requested)) {
          append({
            id: randomUUID(),
            parentId,
            name: posix.basename(requested) || "root",
            path: requested,
            relativePath,
            kind: "other",
            size: 0,
            modifiedAt: 0,
            error: "DOWNLOAD_TREE_NAME_UNSUPPORTED",
          });
          view.skipped++;
          return;
        }
        target.check("read", requested, requested);
        const stat = await target.io.stat(requested);
        guard();
        if (
          !Number.isSafeInteger(stat.size) ||
          stat.size < 0 ||
          !Number.isFinite(stat.mtime)
        )
          throw Error("FILE_IO_INVALID_RESPONSE");
        const entry: DownloadTreeEntry = {
          id: randomUUID(),
          parentId,
          name: posix.basename(requested) || "root",
          path: requested,
          relativePath,
          kind: stat.kind,
          size: stat.size,
          modifiedAt: stat.mtime,
        };
        append(entry);
        if (stat.kind === "symlink" || stat.kind === "other") {
          entry.error =
            stat.kind === "symlink"
              ? "DOWNLOAD_TREE_LINK_SKIPPED"
              : "DOWNLOAD_TREE_SPECIAL_SKIPPED";
          view.skipped++;
          return;
        }
        if (
          stat.kind === "file" &&
          stat.size > DOWNLOAD_CHUNK_BYTES * DOWNLOAD_MAX_CHUNKS
        ) {
          entry.error = "FILE_TOO_LARGE";
          view.skipped++;
          return;
        }
        const canonicalPath = await target.io.resolve(requested);
        guard();
        target.check("read", requested, canonicalPath);
        if (
          !posix.isAbsolute(canonicalPath) ||
          posix.normalize(canonicalPath) !== canonicalPath ||
          (rootCanonical &&
            !canonicalPath.startsWith(rootCanonical.replace(/\/$/, "") + "/"))
        )
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        // A descendant must not be redirected through a substituted ancestor/link after enumeration.
        if (rootCanonical && canonicalPath !== requested)
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        if (visited.has(canonicalPath)) {
          entry.error = "DOWNLOAD_TREE_DUPLICATE_SKIPPED";
          view.skipped++;
          return;
        }
        visited.add(canonicalPath);
        const actual = await target.io.stat(canonicalPath);
        if (attributes(actual) !== attributes(stat))
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        entry.path = canonicalPath;
        if (stat.kind === "file") {
          constraints.set(entry.id, {
            key: target.key,
            peer: target.acceptedHostKey,
            canonicalPath,
            stat: structuredClone(stat),
          });
          view.files++;
          view.totalBytes += stat.size;
          if (!Number.isSafeInteger(view.totalBytes))
            throw Error("DOWNLOAD_TREE_LIMIT");
          return;
        }
        view.directories++;
        directories.set(entry.id, structuredClone(stat));
        const children = await target.io.list!(
          canonicalPath,
          DOWNLOAD_TREE_MAX_ENTRIES - view.entries.length,
          () => {
            guard();
            target.check("read", requested, canonicalPath);
          },
        );
        const names = new Set<string>();
        for (const child of children.sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          guard();
          if (
            !child.name ||
            child.name === "." ||
            child.name === ".." ||
            /[\x00/]/.test(child.name) ||
            names.has(child.name)
          )
            throw Error("FILE_IO_INVALID_RESPONSE");
          names.add(child.name);
          await walk(
            posix.join(canonicalPath, child.name),
            relativePath + "/" + child.name,
            entry.id,
            depth + 1,
            rootCanonical ?? canonicalPath,
          );
        }
        if (
          (await target.io.resolve(requested)) !== canonicalPath ||
          attributes(await target.io.stat(canonicalPath)) !== attributes(stat)
        )
          throw Error("DOWNLOAD_SOURCE_CHANGED");
      };
      for (const selected of selections)
        await walk(selected, posix.basename(selected) || "root", undefined, 0);
      guard();
      await this.ports.audit(actor.userId, "file.download.tree_prepared", {
        id: view.id,
        entries: view.entries.length,
        files: view.files,
        directories: view.directories,
        bytes: view.totalBytes,
        skipped: view.skipped,
      });
      guard();
      view.expiresAt = Date.now() + idleMs;
      this.records.set(view.id, {
        owner: actor.userId,
        view,
        constraints,
        directories,
        targetKey: target.key,
        peer: target.acceptedHostKey,
      });
      return structuredClone(view);
    } finally {
      release?.();
      this.scanning--;
      const count = (this.scanningOwners.get(actor.userId) ?? 1) - 1;
      if (count) this.scanningOwners.set(actor.userId, count);
      else this.scanningOwners.delete(actor.userId);
    }
  }
  async prepareEntry(
    actor: DownloadActor,
    treeId: string,
    entryId: string,
    requestId: string,
    sessionId: string,
  ) {
    const record = this.owned(actor, treeId),
      constraint = record.constraints.get(entryId);
    if (!constraint) throw Error("DOWNLOAD_TREE_ENTRY_UNAVAILABLE");
    record.view.expiresAt = Date.now() + idleMs;
    return this.downloads.prepare(
      actor,
      { requestId, sessionId, path: constraint.canonicalPath },
      constraint,
    );
  }
}
