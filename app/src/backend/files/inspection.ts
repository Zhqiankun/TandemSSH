import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type {
  FileInspectionAction,
  FileDirectoryEntry,
  FileDirectoryView,
  FileStatView,
} from "../../types/file-inspection.js";
import type { FileTaskContext } from "./automated-documents.js";
import type { FileDocumentTarget, RemoteFileStat } from "./ports.js";
import type { FileOperationGuard } from "../collaboration/operations/gateway.js";
import { filePathSchema } from "../collaboration/policies/file-policy.js";
import { DocumentError } from "./errors.js";
interface Snapshot {
  connection: string;
  targetKey: string;
  context: string;
  userId: string;
  path: string;
  canonicalPath: string;
  entries: FileDirectoryEntry[];
  omitted: number;
  observedAt: number;
  size: number;
}
const key = (c: FileTaskContext) =>
  JSON.stringify([
    c.userId,
    c.taskId,
    c.sessionId,
    c.control.generation,
    c.control.controlEpoch,
  ]);
const lifetime = 5 * 60 * 1000;
const same = (a: RemoteFileStat, b: RemoteFileStat) =>
  a.kind === b.kind &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.mtime === b.mtime &&
  a.size === b.size;
const metadata = (s: RemoteFileStat) => ({ ...s, mode: s.mode & 0o7777 });
export class FileInspectionStore {
  private readonly snapshots = new Map<string, Snapshot>();
  clear() {
    this.snapshots.clear();
  }
  prune() {
    const now = Date.now();
    for (const [id, s] of this.snapshots)
      if (now - s.observedAt >= lifetime) this.snapshots.delete(id);
  }
  async inspect(
    action: FileInspectionAction,
    context: FileTaskContext,
    target: FileDocumentTarget,
    guard: FileOperationGuard,
  ): Promise<{ directory?: FileDirectoryView; metadata?: FileStatView }> {
    this.prune();
    guard();
    const requested = posix.normalize(action.path),
      io = target.io;
    if (action.type === "file.list" && action.cursor) {
      const [id, rawOffset] = action.cursor.split(":"),
        snapshot = this.snapshots.get(id),
        offset = Number(rawOffset);
      if (
        !snapshot ||
        snapshot.context !== key(context) ||
        snapshot.connection !== target.connection ||
        snapshot.targetKey !== target.key ||
        snapshot.path !== requested ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset >= snapshot.entries.length
      )
        throw new DocumentError("FILE_DIRECTORY_CURSOR_EXPIRED");
      target.check("read", requested, snapshot.canonicalPath);
      guard(snapshot.canonicalPath);
      return {
        directory: this.page(
          id,
          snapshot,
          offset,
          action.pageSize ?? 50,
          guard,
        ),
      };
    }
    const canonical =
      action.type === "file.stat" && !action.followLinks
        ? posix.join(
            await io.resolve(posix.dirname(requested)),
            posix.basename(requested),
          )
        : await io.resolve(requested);
    if (!filePathSchema.safeParse(canonical).success)
      throw new DocumentError("FILE_IO_INVALID_RESPONSE");
    target.check("read", requested, canonical);
    guard(canonical);
    const before = await io.stat(canonical);
    guard(canonical);
    if (action.type === "file.stat")
      return {
        metadata: {
          path: requested,
          canonicalPath: canonical,
          followedLinks: !!action.followLinks,
          observedAt: Date.now(),
          metadata: metadata(before),
        },
      };
    if (before.kind !== "directory")
      throw new DocumentError("FILE_NOT_DIRECTORY");
    if (!io.list) throw new DocumentError("FILE_LIST_UNAVAILABLE");
    if (!guard.canListEntry)
      throw new DocumentError("FILE_DIRECTORY_SCOPE_REQUIRED");
    const raw = await io.list(canonical, 10000, () => {
      target.check("read", requested, canonical);
      guard(canonical);
    });
    guard(canonical);
    const after = await io.stat(canonical);
    guard(canonical);
    if (!same(before, after)) throw new DocumentError("FILE_DIRECTORY_CHANGED");
    let omitted = 0;
    const entries: FileDirectoryEntry[] = [],
      seen = new Set<string>();
    for (const entry of raw) {
      const path = posix.join(requested, entry.name),
        actual = posix.join(canonical, entry.name);
      if (
        !entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("/") ||
        !filePathSchema.safeParse(path).success ||
        !filePathSchema.safeParse(actual).success
      ) {
        omitted++;
        continue;
      }
      if (seen.has(entry.name))
        throw new DocumentError("FILE_IO_INVALID_RESPONSE");
      seen.add(entry.name);
      if (!guard.canListEntry(path, actual)) {
        omitted++;
        continue;
      }
      entries.push({ name: entry.name, metadata: metadata(entry.stat) });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const size = Buffer.byteLength(JSON.stringify(entries), "utf8");
    const current = [...this.snapshots.values()];
    if (
      size > 2 * 1024 * 1024 ||
      current.length >= 64 ||
      current.reduce((n, s) => n + s.size, 0) + size > 8 * 1024 * 1024 ||
      current
        .filter((s) => s.userId === context.userId)
        .reduce((n, s) => n + s.size, 0) +
        size >
        4 * 1024 * 1024
    )
      throw new DocumentError("FILE_DIRECTORY_CACHE_FULL");
    const id = randomUUID(),
      snapshot: Snapshot = {
        connection: target.connection,
        targetKey: target.key,
        context: key(context),
        userId: context.userId,
        path: requested,
        canonicalPath: canonical,
        entries,
        omitted,
        observedAt: Date.now(),
        size,
      };
    guard(canonical);
    this.snapshots.set(id, snapshot);
    return {
      directory: this.page(id, snapshot, 0, action.pageSize ?? 50, guard),
    };
  }
  private page(
    id: string,
    s: Snapshot,
    offset: number,
    pageSize: number,
    guard: FileOperationGuard,
  ): FileDirectoryView {
    if (!guard.canListEntry)
      throw new DocumentError("FILE_DIRECTORY_SCOPE_REQUIRED");
    const entries: FileDirectoryEntry[] = [];
    let position = offset,
      bytes = 0,
      omitted = s.omitted;
    while (position < s.entries.length && entries.length < pageSize) {
      const entry = s.entries[position],
        cost = Buffer.byteLength(JSON.stringify(entry), "utf8");
      if (bytes + cost > 32000 && entries.length) break;
      if (cost > 32000) throw new DocumentError("FILE_DIRECTORY_TOO_LARGE");
      position++;
      if (
        !guard.canListEntry(
          posix.join(s.path, entry.name),
          posix.join(s.canonicalPath, entry.name),
        )
      ) {
        omitted++;
        continue;
      }
      bytes += cost;
      entries.push(entry);
    }
    guard(s.canonicalPath);
    return {
      path: s.path,
      canonicalPath: s.canonicalPath,
      snapshotId: id,
      observedAt: s.observedAt,
      entries: structuredClone(entries),
      total: s.entries.length,
      omitted,
      offset,
      nextCursor: position < s.entries.length ? id + ":" + position : undefined,
      contentTrust: "untrusted-directory-entries",
    };
  }
}
