import {
  downloadApi,
  downloadErrorCode,
  nativeDownloadValue as value,
  type DownloadApiPort,
} from "@/api/file-download-api";
import {
  DOWNLOAD_CHUNK_BYTES,
  type DownloadSource,
  type LocalDownloadView,
  type DesktopDownloadApi,
} from "@/types/file-download";
export type DownloadJobState =
  | "queued"
  | "checking"
  | "choosing"
  | "awaiting-review"
  | "downloading"
  | "pausing"
  | "paused"
  | "finalizing"
  | "completed"
  | "failed"
  | "unknown"
  | "cancelled";
export interface DownloadJobView {
  id: string;
  name: string;
  path: string;
  sessionId: string;
  hostId?: number;
  hostLabel: string;
  state: DownloadJobState;
  size?: number;
  writtenBytes: number;
  local?: LocalDownloadView;
  error?: string;
  speed?: number;
}
interface Job {
  view: DownloadJobView;
  source?: DownloadSource;
  requestId: string;
  work?: "prepare" | "download" | "resume";
  overwrite: boolean;
  stop?: AbortController;
  cancel: boolean;
  pause: boolean;
}
export class DownloadQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Set<() => void>();
  private snapshot: DownloadJobView[] = [];
  private active = 0;
  private limit = 2;
  private owner?: string;
  private reset: Promise<unknown> = Promise.resolve();
  private dialogs: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly api: DownloadApiPort = downloadApi,
    private readonly native: () => DesktopDownloadApi | undefined = () =>
      window.electronAPI?.downloads,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  getConcurrency = () => this.limit;
  private emit() {
    this.snapshot = [...this.jobs.values()].map((j) => structuredClone(j.view));
    for (const listener of this.listeners) listener();
  }
  setOwner(owner: string | null) {
    if (this.owner === (owner ?? undefined)) return;
    for (const job of this.jobs.values()) {
      job.cancel = true;
      job.stop?.abort();
    }
    this.jobs.clear();
    this.owner = owner ?? undefined;
    this.reset = this.reset.then(() => this.native()?.reset()).catch(() => {});
    this.emit();
  }
  setConcurrency(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 4) return;
    this.limit = limit;
    this.emit();
    this.drain();
  }
  add(input: {
    sessionId: string;
    path: string;
    name: string;
    hostId?: number;
    hostLabel: string;
  }) {
    if (!this.owner) throw Error("DOWNLOAD_OWNER_REQUIRED");
    if (!this.native()) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    if (this.jobs.size >= 256) throw Error("DOWNLOAD_LIMIT");
    const id = crypto.randomUUID();
    this.jobs.set(id, {
      view: { ...input, id, state: "queued", writtenBytes: 0 },
      work: "prepare",
      requestId: crypto.randomUUID(),
      overwrite: false,
      pause: false,
      cancel: false,
    });
    this.emit();
    this.drain();
    return id;
  }
  private job(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw Error("DOWNLOAD_NOT_FOUND");
    return j;
  }
  start(id: string, overwrite: boolean) {
    const j = this.job(id);
    if (j.view.state !== "awaiting-review") return;
    j.overwrite = overwrite;
    j.work = "download";
    j.view.state = "queued";
    this.emit();
    this.drain();
  }
  pause(id: string) {
    const j = this.job(id);
    if (j.view.state !== "downloading") return;
    j.pause = true;
    j.view.state = "pausing";
    this.emit();
  }
  resume(id: string, sessionId?: string) {
    const j = this.job(id);
    if (
      !["paused", "failed"].includes(j.view.state) ||
      !j.view.local?.temporaryPath ||
      !j.source
    )
      return;
    if (sessionId) j.view.sessionId = sessionId;
    j.cancel = false;
    j.pause = false;
    j.work = "resume";
    j.view.state = "queued";
    j.view.error = undefined;
    this.emit();
    this.drain();
  }
  async cancel(id: string) {
    const j = this.job(id);
    if (["completed", "unknown", "finalizing"].includes(j.view.state)) return;
    j.cancel = true;
    j.work = undefined;
    j.stop?.abort();
    if (!j.stop) await this.cleanup(j);
    if (!["completed", "unknown"].includes(j.view.state))
      j.view.state = "cancelled";
    this.emit();
  }
  async retry(id: string) {
    const j = this.job(id);
    if (j.view.state !== "failed") return;
    await this.cleanup(j);
    if (
      j.view.local?.temporaryPath ||
      ["completed", "unknown"].includes(j.view.state)
    ) {
      this.emit();
      return;
    }
    j.source = undefined;
    j.view.local = undefined;
    j.view.writtenBytes = 0;
    j.view.error = undefined;
    j.cancel = false;
    j.pause = false;
    j.requestId = crypto.randomUUID();
    j.work = "prepare";
    j.view.state = "queued";
    this.emit();
    this.drain();
  }
  async show(id: string) {
    const j = this.job(id);
    if (j.view.local)
      value(await this.native()!.action(j.view.local.id, "show"));
  }
  clearFinished() {
    for (const [id, j] of this.jobs)
      if (
        ["completed", "cancelled"].includes(j.view.state) &&
        !j.stop &&
        !j.view.local?.temporaryPath
      )
        this.jobs.delete(id);
    this.emit();
  }
  private guard(j: Job) {
    if (j.cancel || this.jobs.get(j.view.id) !== j)
      throw Error("DOWNLOAD_CANCELLED");
  }
  private async cleanup(j: Job) {
    if (j.source)
      await this.api
        .action(j.view.sessionId, j.source.id, "cancel")
        .catch(() => {});
    if (!j.view.local) return;
    try {
      const result = value(
        await this.native()!.action(j.view.local.id, "cancel"),
      );
      j.view.local = result;
      if (result.state === "completed" || result.state === "unknown")
        j.view.state = result.state;
    } catch {
      j.view.error = "DOWNLOAD_CLEANUP_PENDING";
    }
  }
  private drain() {
    while (this.active < this.limit) {
      const j = [...this.jobs.values()].find((j) => j.work);
      if (!j) break;
      const work = j.work!;
      j.work = undefined;
      this.active++;
      void this.run(j, work).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
  private async run(j: Job, work: "prepare" | "download" | "resume") {
    const stop = new AbortController();
    j.stop = stop;
    let committing = false;
    try {
      await this.reset;
      this.guard(j);
      const native = this.native();
      if (!native) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
      if (work === "prepare") {
        j.view.state = "checking";
        this.emit();
        j.source = await this.api.prepare(
          {
            requestId: j.requestId,
            sessionId: j.view.sessionId,
            path: j.view.path,
          },
          stop.signal,
        );
        this.guard(j);
        j.view.size = j.source.size;
        j.view.path = j.source.canonicalPath;
        j.view.hostLabel = j.source.hostIdentity ?? j.view.hostLabel;
        j.view.state = "choosing";
        this.emit();
        const choose = this.dialogs.then(async () => {
          this.guard(j);
          return value(
            await native.choose({
              name: j.view.name,
              size: j.source!.size,
              sha256: j.source!.sha256,
              hashes: j.source!.hashes,
            }),
          );
        });
        this.dialogs = choose.catch(() => {});
        const local = await choose;
        if (!local) {
          j.cancel = true;
          throw Error("DOWNLOAD_CANCELLED");
        }
        j.view.local = local;
        this.guard(j);
        j.view.state = "awaiting-review";
        return;
      }
      if (!j.source || !j.view.local) throw Error("DOWNLOAD_PREVIEW_REQUIRED");
      if (work === "resume") {
        j.view.state = "checking";
        this.emit();
        j.source = await this.api.action(
          j.view.sessionId,
          j.source.id,
          "resume",
          stop.signal,
        );
        this.guard(j);
        j.view.local = value(await native.action(j.view.local.id, "resume"));
      } else
        j.view.local = value(await native.start(j.view.local.id, j.overwrite));
      this.guard(j);
      j.view.state = "downloading";
      j.view.error = undefined;
      const started = Date.now(),
        baseline = j.view.local.writtenBytes;
      j.view.writtenBytes = baseline;
      this.emit();
      while (j.view.writtenBytes < j.source.size) {
        this.guard(j);
        if (j.pause) break;
        const offset = j.view.writtenBytes,
          expected = Math.min(DOWNLOAD_CHUNK_BYTES, j.source.size - offset);
        const bytes = await this.api.chunk(
          j.view.sessionId,
          j.source.id,
          offset,
          stop.signal,
        );
        this.guard(j);
        if (bytes.byteLength !== expected)
          throw Error("DOWNLOAD_CHUNK_INVALID");
        j.view.local = value(
          await native.append(j.view.local.id, offset, bytes),
        );
        if (j.view.local.writtenBytes !== offset + expected)
          throw Error("DOWNLOAD_PROGRESS_INVALID");
        j.view.writtenBytes = j.view.local.writtenBytes;
        j.view.speed =
          (j.view.writtenBytes - baseline) /
          Math.max(1, (Date.now() - started) / 1000);
        this.emit();
      }
      this.guard(j);
      if (j.pause) {
        j.view.local = value(await native.action(j.view.local.id, "pause"));
        j.source = await this.api.action(
          j.view.sessionId,
          j.source.id,
          "pause",
          stop.signal,
        );
        j.view.state = "paused";
        return;
      }
      j.view.state = "finalizing";
      this.emit();
      j.source = await this.api.action(
        j.view.sessionId,
        j.source.id,
        "verify",
        stop.signal,
      );
      this.guard(j);
      committing = true;
      j.view.local = value(await native.action(j.view.local.id, "finish"));
      if (
        j.view.local.state !== "completed" ||
        j.view.local.sha256 !== j.source.sha256 ||
        j.view.local.writtenBytes !== j.source.size
      )
        throw Error("DOWNLOAD_RESULT_UNVERIFIED");
      committing = false;
      j.view.state = "completed";
    } catch (error) {
      if (j.cancel && !committing) {
        await this.cleanup(j);
        if (!["completed", "unknown"].includes(j.view.state))
          j.view.state = "cancelled";
      } else {
        j.view.error = downloadErrorCode(error);
        j.view.state = committing ? "unknown" : "failed";
      }
    } finally {
      j.stop = undefined;
      this.emit();
    }
  }
}
export const downloadQueue = new DownloadQueue();
