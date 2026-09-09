import { uploadBatchRecoveryApi } from "@/api/upload-batch-recovery-api";
import type { RestoredUploadBatch } from "@/types/upload-batch-recovery";
import type { UploadView } from "@/types/file-upload";
import { uploadTreeApi, type UploadTreeApi } from "@/api/upload-tree-api";
import { uploadErrorCode } from "@/api/file-upload-api";
import type {
  DesktopUploadSourceApi,
  NativeUploadSelection,
} from "@/types/upload-source";
import type {
  UploadTreePreview,
  UploadTreeAction,
  UploadDirectoryResult,
} from "@/types/upload-tree";
import { uploadQueue, type UploadQueue, type UploadQueueState } from "./queue";
import { nativeUploadSource } from "./native-source";
export function uploadSourceValue<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (result.ok === false) throw Error(result.error);
  return result.value;
}
interface Batch {
  id: string;
  owner: string;
  source: NativeUploadSelection;
  target: UploadTreePreview;
  hostLabel: string;
  hostId?: number;
  takeover: boolean;
  state: "creating" | "running" | "saving" | "paused" | "cancelled";
  pauseRequested?: boolean;
  members: Map<string, string>;
  cleared: Partial<Record<UploadQueueState, number>>;
  results: Map<string, UploadDirectoryResult>;
  remaining: Set<string>;
  stop: AbortController;
  directoryWork?: Promise<void>;
  error?: string;
}
export interface UploadBatchView {
  id: string;
  name: string;
  target: string;
  state:
    "creating" | "running" | "saving" | "paused" | "finished" | "cancelled";
  completed: number;
  skipped: number;
  failed: number;
  unknown: number;
  total: number;
  error?: string;
}
export class UploadBatches {
  private records = new Map<string, Batch>();
  private listeners = new Set<() => void>();
  private snapshot: UploadBatchView[] = [];
  private owner?: string;
  private timer?: ReturnType<typeof setInterval>;
  private touching = false;
  constructor(
    private queue: UploadQueue = uploadQueue,
    private api: UploadTreeApi = uploadTreeApi,
    private native: () => DesktopUploadSourceApi | undefined = () =>
      window.electronAPI?.uploadSources,
    private recovery: typeof uploadBatchRecoveryApi = uploadBatchRecoveryApi,
  ) {
    queue.subscribe(() => this.emit());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    const jobs = new Map(this.queue.getSnapshot().map((j) => [j.id, j]));
    this.snapshot = [...this.records.values()].map((b) => {
      const states = [...b.members.values()]
        .map((id) => jobs.get(id)?.state)
        .filter(Boolean);
      const count = (s: UploadQueueState) =>
        states.filter((v) => v === s).length + (b.cleared[s] ?? 0);
      return {
        id: b.id,
        name: b.source.entries
          .filter((e) => !e.parentId)
          .map((e) => e.name)
          .join(", "),
        target: b.target.path,
        state:
          b.state === "running" &&
          states.every((s) =>
            ["completed", "skipped", "cancelled", "failed", "unknown"].includes(
              s!,
            ),
          )
            ? "finished"
            : b.state,
        completed: count("completed"),
        skipped: count("skipped") + count("cancelled"),
        failed: count("failed"),
        unknown: count("unknown"),
        total: b.source.entries.length,
        error: b.error,
      };
    });
    for (const listener of this.listeners) listener();
  }
  setOwner(owner: string | null) {
    if (this.owner === (owner ?? undefined)) return;
    for (const b of this.records.values()) b.stop.abort();
    this.records.clear();
    this.owner = owner ?? undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = owner
      ? setInterval(() => void this.maintain(), 60000)
      : undefined;
    void this.native()
      ?.reset()
      .catch(() => {});
    this.emit();
  }
  private current(b: Batch) {
    if (
      this.records.get(b.id) !== b ||
      b.owner !== this.owner ||
      b.owner !== this.queue.getOwner() ||
      b.stop.signal.aborted ||
      b.state === "cancelled"
    )
      throw Error("UPLOAD_CANCELLED");
  }
  async maintain() {
    if (this.touching) return;
    this.touching = true;
    try {
      await this.queue.maintain();
      for (const b of this.records.values())
        if ((b.state as Batch["state"]) !== "cancelled") {
          try {
            await this.api.touch(
              b.target.sessionId,
              b.target.id,
              b.stop.signal,
            );
            if (this.records.get(b.id) === b) b.error = undefined;
          } catch (e) {
            if (this.records.get(b.id) === b && !b.stop.signal.aborted)
              b.error = uploadErrorCode(e);
          }
        }
    } finally {
      this.touching = false;
      this.emit();
    }
  }
  async start(input: {
    source: NativeUploadSelection;
    target: UploadTreePreview;
    hostLabel: string;
    hostId?: number;
    takeover: boolean;
    decisions: Array<{ id: string; action: UploadTreeAction }>;
  }) {
    const owner = this.owner,
      native = this.native();
    if (!owner || owner !== this.queue.getOwner())
      throw Error("UPLOAD_OWNER_REQUIRED");
    if (!native) throw Error("UPLOAD_DESKTOP_REQUIRED");
    const reservation = this.queue.reserve(input.source.entries.length);
    const b: Batch = {
      ...input,
      id: crypto.randomUUID(),
      owner,
      state: "creating",
      members: new Map(),
      results: new Map(),
      cleared: {},
      remaining: new Set(input.source.entries.map((e) => e.id)),
      stop: new AbortController(),
    };
    try {
      b.target = await this.api.confirm(
        b.target.sessionId,
        b.target.id,
        b.target.revision,
        input.decisions,
      );
      if (owner !== this.owner || owner !== this.queue.getOwner())
        throw Error("UPLOAD_CANCELLED");
      this.records.set(b.id, b);
      const targets = new Map(b.target.entries.map((e) => [e.id, e]));
      for (const entry of b.source.entries) {
        const target = targets.get(entry.id),
          skip = !!entry.error || !target || target.action === "skip";
        const base = {
          sessionId: b.target.sessionId,
          path: target?.path ?? b.target.path,
          name: entry.relativePath,
          size: entry.size,
          hostId: b.hostId,
          hostLabel: b.hostLabel,
          batchId: b.id,
          kind:
            entry.kind === "directory"
              ? ("directory" as const)
              : ("file" as const),
          localPath: entry.path,
        };
        const release = () => this.release(b, entry.id);
        const job =
          entry.kind === "file" && !skip
            ? reservation.file(
                {
                  ...base,
                  file: nativeUploadSource(native, b.source.id, entry),
                },
                {
                  kind: "file",
                  ready: () => b.state === "running" && !b.stop.signal.aborted,
                  overwrite: target?.action === "overwrite",
                  takeover: b.takeover,
                  release,
                  completed: async (uploadId) => {
                    this.current(b);
                    await this.api.complete(
                      b.target.sessionId,
                      b.target.id,
                      entry.id,
                      uploadId,
                    );
                  },
                  prepare: async (requestId, sessionId, manifest, signal) => {
                    this.current(b);
                    let parent = entry.parentId;
                    while (parent) {
                      if (
                        !["created", "merged"].includes(
                          b.results.get(parent)?.state ?? "",
                        )
                      )
                        throw Error("UPLOAD_TREE_PARENT_UNAVAILABLE");
                      parent = targets.get(parent)?.parentId;
                    }
                    return this.api.prepare(
                      sessionId,
                      b.target.id,
                      entry.id,
                      requestId,
                      manifest,
                      signal,
                    );
                  },
                },
              )
            : reservation.record(
                base,
                {
                  kind: "record",
                  release,
                  retry:
                    entry.kind === "directory"
                      ? (takeover) => this.directories(b, takeover)
                      : undefined,
                },
                skip ? "skipped" : "queued",
              );
        b.members.set(entry.id, job);
        if (skip)
          this.queue.updateRecord(
            job,
            {
              state: "skipped",
              error: entry.error ?? target?.error,
            },
            false,
          );
      }
      this.emit();
      void this.directories(b, b.takeover);
      return b.id;
    } finally {
      reservation.close();
    }
  }
  private applyResults(
    b: Batch,
    entries: Array<{ id: string; result?: UploadDirectoryResult }>,
    fallback?: UploadQueueState,
  ) {
    for (const entry of entries) {
      const job = b.members.get(entry.id);
      if (!job) continue;
      if (entry.result) b.results.set(entry.id, entry.result);
      const result =
        entry.result ??
        (b.results.get(entry.id)?.state === "unknown"
          ? b.results.get(entry.id)
          : undefined);
      const state =
        result?.state === "created" || result?.state === "merged"
          ? "completed"
          : (result?.state ?? fallback ?? "failed");
      if (state === "unknown" && !result)
        b.results.set(entry.id, { state: "unknown", error: b.error });
      this.queue.updateRecord(job, {
        state,
        error:
          result?.error ??
          (state === "completed" || state === "skipped" ? undefined : b.error),
      });
    }
  }
  private directories(b: Batch, takeover: boolean): Promise<void> {
    if (b.directoryWork) return b.directoryWork;
    const work = this.createDirectories(b, takeover);
    b.directoryWork = work;
    void work.finally(() => {
      b.directoryWork = undefined;
    });
    return work;
  }
  private async createDirectories(b: Batch, takeover: boolean) {
    try {
      this.current(b);
      b.state = "creating";
      this.emit();
      const results = await this.api.directories(
        b.target.sessionId,
        b.target.id,
        takeover,
        b.stop.signal,
      );
      if (this.records.get(b.id) !== b) return;
      this.applyResults(
        b,
        results.map((r) => ({ id: r.id, result: r })),
      );
      if ((b.state as Batch["state"]) !== "cancelled")
        b.state = b.pauseRequested ? "paused" : "running";
      b.error = undefined;
    } catch (error) {
      if (this.records.get(b.id) !== b) return;
      b.error = uploadErrorCode(error);
      try {
        const current = await this.api.get(b.target.sessionId, b.target.id);
        if (this.records.get(b.id) !== b) return;
        // A lost response cannot prove that a directory was never created.
        const knownNoWrite = [
          "FILE_AUTOMATION_ACTIVE",
          "UPLOAD_TREE_EXPIRED",
          "UPLOAD_STATE_INVALID",
          "UPLOAD_CANCELLED",
        ].includes(b.error);
        this.applyResults(
          b,
          current.entries.filter((e) => e.kind === "directory"),
          knownNoWrite
            ? b.state === "cancelled"
              ? "cancelled"
              : "failed"
            : "unknown",
        );
      } catch {
        this.applyResults(
          b,
          b.target.entries
            .filter((e) => e.kind === "directory")
            .map((e) => ({ id: e.id })),
          "unknown",
        );
      }
      if ((b.state as Batch["state"]) !== "cancelled")
        b.state = b.pauseRequested ? "paused" : "running";
    } finally {
      this.queue.wake();
      this.emit();
    }
  }
  async save(id: string) {
    const b = this.records.get(id);
    if (!b) throw Error("UPLOAD_NOT_FOUND");
    this.current(b);
    if (b.state === "saving") throw Error("UPLOAD_BUSY");
    b.pauseRequested = true;
    b.state = "saving";
    this.emit();
    const ids = [...b.members.values()];
    try {
      await b.directoryWork;
      b.state = "saving";
      const views = await this.queue.quiesce(ids);
      this.current(b);
      const byId = new Map(views.map((j) => [j.id, j]));
      const members = b.target.entries
        .filter((e) => e.kind === "file")
        .map((e) => {
          const job = byId.get(b.members.get(e.id)!);
          return {
            entryId: e.id,
            uploadId:
              job?.transfer &&
              !["completed", "cancelled"].includes(job.transfer.state)
                ? job.transfer.id
                : undefined,
            cancelled: job?.state === "cancelled" || job?.state === "skipped",
          };
        });
      const record = await this.recovery.save(b.target.sessionId, {
        id: b.id,
        treeId: b.target.id,
        sourceId: b.source.id,
        members,
      });
      this.current(b);
      this.queue.releaseSaved(ids);
      b.stop.abort();
      this.records.delete(id);
      this.emit();
      return record;
    } catch (error) {
      if (this.records.get(id) === b) {
        b.state = "paused";
        b.error = uploadErrorCode(error);
        this.queue.unfreeze(ids);
        this.emit();
      }
      throw error;
    }
  }
  async resumeBatch(id: string, takeover = false) {
    const b = this.records.get(id);
    if (!b) throw Error("UPLOAD_NOT_FOUND");
    this.current(b);
    if (b.state !== "paused") return;
    b.pauseRequested = false;
    b.takeover = takeover;
    this.queue.unfreeze([...b.members.values()]);
    await this.directories(b, takeover);
    for (const job of this.queue.getSnapshot())
      if (job.batchId === id && ["paused", "failed"].includes(job.state))
        this.queue.resume(job.id, b.target.sessionId, takeover);
    this.queue.wake();
    this.emit();
  }
  private receiptView(
    tree: UploadTreePreview,
    e: UploadTreePreview["entries"][number],
  ): UploadView | undefined {
    const r = e.fileResult;
    if (!r) return undefined;
    return {
      id: r.transferId,
      name: e.name,
      path: e.path,
      canonicalPath: e.path,
      sessionId: tree.sessionId,
      hostIdentity: tree.hostIdentity,
      totalBytes: r.bytes,
      receivedBytes: r.bytes,
      chunkBytes: 4194304,
      state: "completed",
      verification: "sha256",
      sha256: r.sha256,
      createdAt: r.completedAt,
      expiresAt: r.completedAt,
    };
  }
  reserveRestore(count: number) {
    return this.queue.reserve(count);
  }
  async restore(
    saved: RestoredUploadBatch,
    hostId?: number,
    reserved?: ReturnType<UploadQueue["reserve"]>,
  ) {
    const owner = this.owner,
      native = this.native();
    if (!owner || owner !== this.queue.getOwner() || !native)
      throw Error("UPLOAD_OWNER_REQUIRED");
    const reservation =
        reserved ?? this.queue.reserve(saved.source.entries.length),
      b: Batch = {
        id: saved.summary.id,
        owner,
        source: saved.source,
        target: saved.tree,
        hostId,
        hostLabel: saved.tree.hostIdentity ?? "SSH",
        takeover: false,
        state: "paused",
        pauseRequested: true,
        members: new Map(),
        cleared: {},
        results: new Map(),
        remaining: new Set(saved.source.entries.map((e) => e.id)),
        stop: new AbortController(),
      };
    try {
      if (this.records.has(b.id)) throw Error("UPLOAD_BUSY");
      this.records.set(b.id, b);
      const targets = new Map(b.target.entries.map((e) => [e.id, e])),
        members = new Map(saved.members.map((m) => [m.entryId, m]));
      for (const entry of b.source.entries) {
        const e = targets.get(entry.id),
          m = members.get(entry.id),
          completed = e?.fileResult,
          skip =
            !!entry.error ||
            !e ||
            e.action === "skip" ||
            m?.state === "cancelled",
          state: UploadQueueState = completed
            ? "completed"
            : skip
              ? "skipped"
              : m?.state === "unknown" || m?.state === "committing"
                ? "unknown"
                : m?.state === "paused"
                  ? "paused"
                  : "queued";
        const base = {
            sessionId: b.target.sessionId,
            path: e?.path ?? b.target.path,
            name: entry.relativePath,
            size: entry.size,
            hostId,
            hostLabel: b.hostLabel,
            batchId: b.id,
            kind:
              entry.kind === "directory"
                ? ("directory" as const)
                : ("file" as const),
            localPath: entry.path,
          },
          release = () => this.release(b, entry.id);
        const job =
          entry.kind === "file" && !skip && !completed && state !== "unknown"
            ? reservation.file(
                {
                  ...base,
                  file: nativeUploadSource(native, b.source.id, entry),
                },
                {
                  kind: "file",
                  ready: () => b.state === "running" && !b.stop.signal.aborted,
                  overwrite: e?.action === "overwrite",
                  takeover: false,
                  release,
                  completed: async (uploadId) => {
                    this.current(b);
                    await this.api.complete(
                      b.target.sessionId,
                      b.target.id,
                      entry.id,
                      uploadId,
                    );
                  },
                  prepare: (requestId, sessionId, manifest, signal) => {
                    this.current(b);
                    return this.api.prepare(
                      sessionId,
                      b.target.id,
                      entry.id,
                      requestId,
                      manifest,
                      signal,
                    );
                  },
                },
              )
            : reservation.record(
                base,
                {
                  kind: "record",
                  release,
                  retry:
                    entry.kind === "directory"
                      ? (takeover) => this.directories(b, takeover)
                      : undefined,
                },
                state,
              );
        b.members.set(entry.id, job);
        this.queue.adoptBatch(
          job,
          b.id,
          state,
          completed ? this.receiptView(b.target, e!) : m?.view,
          m?.manifest,
        );
      }
      this.applyResults(
        b,
        b.target.entries.filter((e) => e.kind === "directory"),
        "queued",
      );
      this.emit();
      return b.id;
    } finally {
      reservation.close();
    }
  }
  reconciled(id: string, tree: UploadTreePreview) {
    const b = this.records.get(id);
    if (!b) return;
    b.target = tree;
    for (const e of tree.entries) {
      const job = b.members.get(e.id),
        view = this.receiptView(tree, e);
      if (job && view) this.queue.completeRecord(job, view);
    }
    this.emit();
  }
  async cancel(id: string) {
    const b = this.records.get(id);
    if (!b) return;
    if (b.state === "saving") return;
    b.state = "cancelled";
    this.emit();
    // Stop queued/in-flight file writes immediately. The directory request is observed to completion.
    for (const job of b.members.values())
      await this.queue.cancel(job).catch(() => {});
    try {
      await this.api.cancel(b.target.sessionId, b.target.id);
      await b.directoryWork;
      const current = await this.api.get(b.target.sessionId, b.target.id);
      if (this.records.get(id) === b)
        this.applyResults(
          b,
          current.entries.filter((e) => e.kind === "directory"),
          "cancelled",
        );
    } catch (e) {
      if (this.records.get(id) === b) b.error = uploadErrorCode(e);
    }
    this.emit();
  }
  private async release(b: Batch, entryId: string) {
    if (this.records.get(b.id) !== b) return;
    if (b.state === "saving") throw Error("UPLOAD_BUSY");
    if (b.remaining.size === 1 && b.remaining.has(entryId)) {
      if (b.directoryWork) throw Error("UPLOAD_CLEANUP_PENDING");
      try {
        await this.api.forget(b.target.sessionId, b.target.id);
      } catch (e) {
        if (uploadErrorCode(e) !== "UPLOAD_NOT_FOUND") throw e;
      }
      const native = this.native();
      if (!native) throw Error("UPLOAD_DESKTOP_REQUIRED");
      const result = await native.forget(b.source.id);
      if (result.ok === false && result.error !== "UPLOAD_SOURCE_NOT_FOUND")
        uploadSourceValue(result);
      b.stop.abort();
      this.records.delete(b.id);
    }
    const state = this.queue
      .getSnapshot()
      .find((j) => j.id === b.members.get(entryId))?.state;
    if (state) b.cleared[state] = (b.cleared[state] ?? 0) + 1;
    b.remaining.delete(entryId);
    b.members.delete(entryId);
    this.emit();
  }
}
export const uploadBatches = new UploadBatches();
