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
  state: "creating" | "running" | "cancelled";
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
  state: "creating" | "running" | "finished" | "cancelled";
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
      if ((b.state as Batch["state"]) !== "cancelled") b.state = "running";
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
      if ((b.state as Batch["state"]) !== "cancelled") b.state = "running";
    } finally {
      this.queue.wake();
      this.emit();
    }
  }
  async cancel(id: string) {
    const b = this.records.get(id);
    if (!b) return;
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
