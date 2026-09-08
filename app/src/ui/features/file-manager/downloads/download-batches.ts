import { downloadTreeApi, type DownloadTreeApi } from "@/api/download-tree-api";
import {
  downloadApi,
  downloadErrorCode,
  nativeDownloadValue as value,
  type DownloadApiPort,
} from "@/api/file-download-api";
import type {
  DownloadTreePreview,
  LocalDownloadTreePreview,
  LocalDownloadTreeAction,
  DirectoryDownloadResult,
  DesktopDownloadDirectoryApi,
} from "@/types/download-tree";
import {
  downloadQueue,
  type DownloadQueue,
  type DownloadJobState,
} from "./queue";
interface Batch {
  id: string;
  owner: string;
  source: DownloadTreePreview;
  target: LocalDownloadTreePreview;
  hostLabel: string;
  hostId?: number;
  members: Map<string, string>;
  cleared: Partial<Record<DownloadJobState, number>>;
  remaining: Set<string>;
  state: "creating" | "running" | "cancelled";
  results: Map<string, DirectoryDownloadResult>;
  stop: AbortController;
  busy: boolean;
  error?: string;
}
export interface DownloadBatchView {
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
const absent = (error: unknown) =>
  downloadErrorCode(error) === "DOWNLOAD_NOT_FOUND";
export class DownloadBatches {
  private records = new Map<string, Batch>();
  private listeners = new Set<() => void>();
  private snapshot: DownloadBatchView[] = [];
  private owner?: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private touching = false;
  constructor(
    private queue: DownloadQueue = downloadQueue,
    private api: DownloadTreeApi = downloadTreeApi,
    private files: DownloadApiPort = downloadApi,
    private native: () => DesktopDownloadDirectoryApi | undefined = () =>
      window.electronAPI?.downloadDirectories,
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
      const count = (s: DownloadJobState) =>
        states.filter((v) => v === s).length + (b.cleared[s] ?? 0);
      const terminal = states.every((s) =>
        ["completed", "cancelled", "skipped", "failed", "unknown"].includes(s!),
      );
      return {
        id: b.id,
        name: b.source.entries
          .filter((e) => !e.parentId)
          .map((e) => e.name)
          .join(", "),
        target: b.target.path,
        state: b.state === "running" && terminal ? "finished" : b.state,
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
    this.owner = owner ?? undefined;
    for (const b of this.records.values()) b.stop.abort();
    this.records.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = owner
      ? setInterval(() => void this.maintain(), 60000)
      : undefined;
    this.emit();
  }
  private current(b: Batch) {
    if (
      this.records.get(b.id) !== b ||
      this.owner !== b.owner ||
      this.queue.getOwner() !== b.owner ||
      b.stop.signal.aborted
    )
      throw Error("DOWNLOAD_CANCELLED");
  }
  private desktop() {
    const api = this.native();
    if (!api) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    return api;
  }
  async maintain() {
    if (this.touching) return;
    this.touching = true;
    try {
      await this.queue.maintain();
      for (const b of this.records.values())
        if (b.state !== "cancelled") {
          try {
            await this.api.touch(
              b.source.sessionId,
              b.source.id,
              b.stop.signal,
            );
            if (this.records.get(b.id) === b) b.error = undefined;
          } catch (error) {
            if (this.records.get(b.id) === b && !b.stop.signal.aborted)
              b.error = downloadErrorCode(error);
          }
        }
      this.emit();
    } finally {
      this.touching = false;
    }
  }
  async start(input: {
    source: DownloadTreePreview;
    target: LocalDownloadTreePreview;
    decisions: Array<{ id: string; action: LocalDownloadTreeAction }>;
    hostLabel: string;
    hostId?: number;
  }) {
    const owner = this.owner;
    if (!owner || owner !== this.queue.getOwner())
      throw Error("DOWNLOAD_OWNER_REQUIRED");
    const reservation = this.queue.reserve(input.source.entries.length),
      native = this.desktop();
    const b: Batch = {
      ...input,
      id: crypto.randomUUID(),
      owner,
      members: new Map(),
      cleared: {},
      remaining: new Set(input.source.entries.map((e) => e.id)),
      state: "creating",
      results: new Map(),
      stop: new AbortController(),
      busy: false,
    };
    try {
      await this.api.touch(b.source.sessionId, b.source.id, b.stop.signal);
      if (owner !== this.owner || owner !== this.queue.getOwner())
        throw Error("DOWNLOAD_CANCELLED");
      b.target = value(
        await native.confirm(b.target.id, b.target.revision, input.decisions),
      );
      if (owner !== this.owner || owner !== this.queue.getOwner())
        throw Error("DOWNLOAD_CANCELLED");
      this.records.set(b.id, b);
      const targets = new Map(b.target.entries.map((e) => [e.id, e]));
      for (const entry of b.source.entries) {
        const target = targets.get(entry.id),
          skipped = !!entry.error || !target || target.action === "skip";
        const base = {
          sessionId: b.source.sessionId,
          path: entry.path,
          name: entry.relativePath,
          hostId: b.hostId,
          hostLabel: b.hostLabel,
          batchId: b.id,
          kind:
            entry.kind === "directory"
              ? ("directory" as const)
              : ("file" as const),
          localPath: target?.path,
        };
        const release = () => this.release(b, entry.id);
        const show = async () => {
          value(await this.desktop().show(b.target.id, entry.id));
        };
        let jobId: string;
        if (entry.kind === "file" && !skipped) {
          jobId = reservation.file(base, {
            kind: "file",
            overwrite: target?.action === "overwrite",
            ready: () => b.state === "running" && !b.stop.signal.aborted,
            release,
            show,
            prepare: async (requestId, sessionId, signal) => {
              this.current(b);
              let parent = entry.parentId;
              while (parent) {
                if (
                  !["created", "merged"].includes(
                    b.results.get(parent)?.state ?? "",
                  )
                )
                  throw Error("DOWNLOAD_TREE_PARENT_UNAVAILABLE");
                parent = b.source.entries.find(
                  (e) => e.id === parent,
                )?.parentId;
              }
              return this.api.prepare(
                sessionId,
                b.source.id,
                entry.id,
                requestId,
                signal,
              );
            },
            choose: async (source) => {
              this.current(b);
              return value(
                await this.desktop().file(b.target.id, entry.id, {
                  name: target!.name,
                  size: source.size,
                  sha256: source.sha256,
                  hashes: source.hashes,
                }),
              );
            },
            complete: async (source) => {
              value(await this.desktop().complete(b.target.id, entry.id));
              await this.files.action(source.sessionId, source.id, "forget");
            },
          });
        } else {
          jobId = reservation.record(
            base,
            {
              kind: "record",
              release,
              show,
              retry:
                entry.kind === "directory"
                  ? () => this.createDirectories(b)
                  : undefined,
            },
            skipped ? "skipped" : "queued",
          );
          if (skipped)
            this.queue.updateRecord(jobId, {
              state: "skipped",
              error: entry.error ?? target?.error,
            });
        }
        b.members.set(entry.id, jobId);
      }
      this.emit();
      // The batch owns execution after admission; closing the preview does not abandon it.
      void this.createDirectories(b);
      return b.id;
    } finally {
      reservation.close();
    }
  }
  private async createDirectories(b: Batch) {
    if (b.busy) return;
    b.busy = true;
    try {
      this.current(b);
      b.state = "creating";
      this.emit();
      const results = value(await this.desktop().directories(b.target.id));
      this.current(b);
      for (const result of results) {
        b.results.set(result.id, result);
        const job = b.members.get(result.id);
        if (!job) continue;
        const state: DownloadJobState =
          result.state === "created" || result.state === "merged"
            ? "completed"
            : result.state === "skipped"
              ? "skipped"
              : result.state === "unknown"
                ? "unknown"
                : "failed";
        this.queue.updateRecord(job, {
          state,
          error: result.error,
          localPath: result.path,
        });
      }
      b.state = "running";
      b.error = undefined;
    } catch (error) {
      if (this.records.get(b.id) !== b) return;
      b.error = downloadErrorCode(error);
      // Observe the final directory results after cancellation, without retrying writes.
      try {
        const current = value(await this.desktop().cancel(b.target.id));
        for (const entry of current.entries.filter(
          (e) => e.kind === "directory",
        )) {
          const job = b.members.get(entry.id);
          if (job)
            this.queue.updateRecord(job, {
              state:
                entry.result?.state === "created" ||
                entry.result?.state === "merged"
                  ? "completed"
                  : entry.result?.state === "unknown"
                    ? "unknown"
                    : b.stop.signal.aborted
                      ? "cancelled"
                      : "failed",
              error: entry.result?.error ?? b.error,
              localPath: entry.path,
            });
        }
      } catch {
        /* Window teardown may already have revoked the capability. */
      }
      b.state = "cancelled";
      for (const [entry, job] of b.members)
        if (b.source.entries.find((e) => e.id === entry)?.kind === "file")
          await this.queue.cancel(job).catch(() => {});
    } finally {
      b.busy = false;
      this.queue.wake();
      this.emit();
    }
  }
  async cancel(id: string) {
    const b = this.records.get(id);
    if (!b) return;
    b.stop.abort();
    b.state = "cancelled";
    await this.desktop().cancel(b.target.id);
    for (const job of b.members.values())
      await this.queue.cancel(job).catch(() => {});
    this.emit();
  }
  private async release(b: Batch, entryId: string) {
    if (this.records.get(b.id) !== b) return;
    if (b.remaining.size === 1 && b.remaining.has(entryId)) {
      if (b.busy) throw Error("DOWNLOAD_BUSY");
      const result = await this.desktop().forget(b.target.id);
      if (result.ok === false && result.error !== "DOWNLOAD_NOT_FOUND")
        value(result);
      try {
        await this.api.forget(b.source.sessionId, b.source.id);
      } catch (error) {
        if (!absent(error)) throw error;
      }
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
export const downloadBatches = new DownloadBatches();
