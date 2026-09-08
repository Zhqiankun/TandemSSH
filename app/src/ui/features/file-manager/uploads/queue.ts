import {
  uploadApi,
  uploadErrorCode,
  type UploadApiPort,
} from "@/api/file-upload-api";
import {
  UPLOAD_CHUNK_BYTES,
  type UploadManifest,
  type UploadView,
} from "@/types/file-upload";
import { chunkHash, uploadManifest } from "./source";
export type UploadQueueState =
  | "queued"
  | "checking"
  | "awaiting-review"
  | "uploading"
  | "pausing"
  | "paused"
  | "finalizing"
  | "completed"
  | "failed"
  | "unknown"
  | "cancelled"
  | "skipped";
export interface UploadJobView {
  id: string;
  name: string;
  path: string;
  sessionId: string;
  hostId?: number;
  hostLabel: string;
  size: number;
  state: UploadQueueState;
  sourceCheckedBytes: number;
  transfer?: UploadView;
  error?: string;
  speed?: number;
}
interface Job {
  view: UploadJobView;
  file?: File;
  manifest?: UploadManifest;
  controller?: AbortController;
  work?: "prepare" | "upload" | "resume";
  requestId: string;
  overwrite: boolean;
  takeover: boolean;
  pause: boolean;
  cancel: boolean;
  startedAt: number;
  startBytes: number;
}
export class UploadQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Set<() => void>();
  private snapshot: UploadJobView[] = [];
  private owner: string | undefined;
  private active = 0;
  private limit = 2;
  constructor(private readonly api: UploadApiPort = uploadApi) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  getConcurrency = () => this.limit;
  setOwner(owner: string) {
    if (this.owner && this.owner !== owner) this.resetForSignOut();
    this.owner = owner;
  }
  resetForSignOut() {
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    this.owner = undefined;
    for (const j of jobs) {
      j.cancel = true;
      j.work = undefined;
      j.controller?.abort();
      j.file = undefined;
      j.manifest = undefined;
      if (!j.controller && j.view.transfer)
        void this.api
          .action(j.view.sessionId, j.view.transfer.id, "cancel", {
            cleanup: true,
          })
          .catch(() => {});
    }
    this.emit();
  }
  setConcurrency(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 4) return;
    this.limit = value;
    this.emit();
    this.drain();
  }
  private emit() {
    this.snapshot = [...this.jobs.values()].map((j) => structuredClone(j.view));
    for (const listener of this.listeners) listener();
  }
  add(input: {
    file: File;
    sessionId: string;
    path: string;
    hostId?: number;
    hostLabel: string;
  }) {
    if (this.jobs.size >= 256) throw Error("UPLOAD_LIMIT");
    const id = crypto.randomUUID();
    this.jobs.set(id, {
      view: {
        id,
        name: input.file.name,
        size: input.file.size,
        path: input.path,
        sessionId: input.sessionId,
        hostId: input.hostId,
        hostLabel: input.hostLabel,
        state: "queued",
        sourceCheckedBytes: 0,
      },
      file: input.file,
      work: "prepare",
      requestId: crypto.randomUUID(),
      overwrite: false,
      takeover: false,
      pause: false,
      cancel: false,
      startedAt: 0,
      startBytes: 0,
    });
    this.emit();
    this.drain();
    return id;
  }
  private job(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw Error("UPLOAD_NOT_FOUND");
    return job;
  }
  start(id: string, overwrite: boolean, takeover = false) {
    const j = this.job(id);
    if (j.view.state !== "awaiting-review") return;
    j.overwrite = overwrite;
    j.takeover = takeover;
    j.work = "upload";
    j.view.state = "queued";
    j.view.error = undefined;
    this.emit();
    this.drain();
  }
  pause(id: string) {
    const j = this.job(id);
    if (j.view.state !== "uploading") return;
    j.pause = true;
    j.view.state = "pausing";
    this.emit();
  }
  resume(id: string, sessionId: string, takeover = false) {
    const j = this.job(id);
    if (
      !["paused", "failed"].includes(j.view.state) ||
      !j.file ||
      !j.view.transfer?.temporaryPath
    )
      return;
    j.view.sessionId = sessionId;
    j.takeover = takeover;
    j.pause = false;
    j.cancel = false;
    j.work = "resume";
    j.view.state = "queued";
    j.view.error = undefined;
    this.emit();
    this.drain();
  }
  async repreview(id: string, name?: string, sessionId?: string) {
    const j = this.job(id);
    if (
      !j.file ||
      ["checking", "uploading", "pausing", "finalizing"].includes(j.view.state)
    )
      return;
    if (j.view.transfer) {
      try {
        this.cancellationResult(
          j,
          await this.api.action(
            j.view.sessionId,
            j.view.transfer.id,
            "cancel",
            { cleanup: true },
          ),
        );
      } catch {
        j.view.error = "UPLOAD_CLEANUP_PENDING";
        this.emit();
        return;
      }
      if (j.view.transfer.state === "completed") {
        j.view.state = "completed";
        j.file = undefined;
        j.manifest = undefined;
        this.emit();
        return;
      }
      if (
        j.view.transfer.temporaryPath ||
        j.view.transfer.state !== "cancelled"
      ) {
        j.view.error = j.view.transfer.error ?? "UPLOAD_CLEANUP_PENDING";
        this.emit();
        return;
      }
    }
    if (name) {
      if (
        !name.trim() ||
        name.includes("/") ||
        /[\\\x00-\x1f]/.test(name) ||
        name === "." ||
        name === ".."
      )
        throw Error("FILE_PATH_INVALID");
      j.view.path =
        j.view.path.slice(0, j.view.path.lastIndexOf("/") + 1) + name;
    }
    if (sessionId) j.view.sessionId = sessionId;
    j.view.transfer = undefined;
    j.view.error = undefined;
    j.cancel = false;
    j.pause = false;
    j.requestId = crypto.randomUUID();
    j.work = "prepare";
    j.view.state = "queued";
    this.emit();
    this.drain();
  }
  private cancellationResult(j: Job, value: UploadView) {
    j.view.transfer = value;
    if (
      value.state === "completed" &&
      value.verification === "sha256" &&
      value.receivedBytes === j.view.size
    ) {
      j.view.state = "completed";
      j.view.error = undefined;
      j.file = undefined;
      j.manifest = undefined;
    } else if (["completed", "unknown", "committing"].includes(value.state)) {
      j.view.state = "unknown";
      j.view.error = value.error ?? "UPLOAD_RESULT_INVALID";
    } else
      j.view.error =
        value.error ??
        (value.temporaryPath ? "UPLOAD_CLEANUP_PENDING" : undefined);
  }
  async cancel(id: string, skip = false) {
    const j = this.job(id);
    if (["completed", "unknown", "finalizing"].includes(j.view.state)) return;
    j.cancel = true;
    j.work = undefined;
    j.controller?.abort();
    if (!j.controller && j.view.transfer) {
      try {
        this.cancellationResult(
          j,
          await this.api.action(
            j.view.sessionId,
            j.view.transfer.id,
            "cancel",
            { cleanup: true },
          ),
        );
      } catch {
        j.view.error = "UPLOAD_CLEANUP_PENDING";
      }
    }
    if (!["completed", "unknown"].includes(j.view.state))
      j.view.state = skip ? "skipped" : "cancelled";
    this.emit();
  }
  removeFinished() {
    for (const [id, j] of this.jobs)
      if (
        ["completed", "cancelled", "skipped"].includes(j.view.state) &&
        !j.controller &&
        !j.view.transfer?.temporaryPath
      )
        this.jobs.delete(id);
    this.emit();
  }
  private check(view: UploadView, state: UploadView["state"]) {
    if (view.state !== state)
      throw Error(view.error ?? "UPLOAD_RESULT_INVALID");
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
  private async run(j: Job, work: "prepare" | "upload" | "resume") {
    const stop = new AbortController();
    j.controller = stop;
    let waitingForCommit = false;
    try {
      if (!j.file) throw Error("UPLOAD_SOURCE_UNAVAILABLE");
      if (work === "prepare" || work === "resume") {
        j.view.state = "checking";
        j.view.sourceCheckedBytes = 0;
        this.emit();
        j.manifest = await uploadManifest(
          j.file,
          stop.signal,
          (n) => {
            j.view.sourceCheckedBytes = n;
            this.emit();
          },
          j.manifest,
        );
      }
      if (j.cancel) throw Error("UPLOAD_CANCELLED");
      if (work === "prepare") {
        j.view.transfer = await this.api.prepare(
          {
            sessionId: j.view.sessionId,
            path: j.view.path,
            manifest: j.manifest!,
            requestId: j.requestId,
          },
          stop.signal,
        );
        this.check(j.view.transfer, "preview");
        j.view.state = "awaiting-review";
        return;
      }
      if (!j.view.transfer || !j.manifest)
        throw Error("UPLOAD_PREVIEW_REQUIRED");
      j.view.transfer =
        work === "resume"
          ? await this.api.action(
              j.view.sessionId,
              j.view.transfer.id,
              "resume",
              { sessionId: j.view.sessionId, takeover: j.takeover },
              stop.signal,
            )
          : await this.api.start(
              j.view.sessionId,
              j.view.transfer.id,
              { overwrite: j.overwrite, takeover: j.takeover },
              stop.signal,
            );
      this.check(j.view.transfer, "uploading");
      j.view.state = "uploading";
      j.startedAt = Date.now();
      j.startBytes = j.view.transfer.receivedBytes;
      this.emit();
      while (j.view.transfer.receivedBytes < j.manifest.size) {
        if (j.cancel) throw Error("UPLOAD_CANCELLED");
        if (j.pause) break;
        const offset = j.view.transfer.receivedBytes,
          end = Math.min(offset + UPLOAD_CHUNK_BYTES, j.manifest.size),
          blob = j.file.slice(offset, end);
        if (
          (await chunkHash(blob)) !==
          j.manifest.hashes[offset / UPLOAD_CHUNK_BYTES]
        )
          throw Error("UPLOAD_SOURCE_CHANGED");
        if (j.cancel) throw Error("UPLOAD_CANCELLED");
        j.view.transfer = await this.api.chunk(
          j.view.sessionId,
          j.view.transfer.id,
          offset,
          blob,
          stop.signal,
        );
        this.check(j.view.transfer, "uploading");
        if (j.view.transfer.receivedBytes !== end)
          throw Error("UPLOAD_PROGRESS_INVALID");
        j.view.speed =
          (end - j.startBytes) / Math.max(1, (Date.now() - j.startedAt) / 1000);
        this.emit();
      }
      if (j.cancel) throw Error("UPLOAD_CANCELLED");
      if (j.pause) {
        j.view.transfer = await this.api.action(
          j.view.sessionId,
          j.view.transfer.id,
          "pause",
          {},
          stop.signal,
        );
        this.check(j.view.transfer, "paused");
        j.view.state = "paused";
        return;
      }
      j.view.state = "finalizing";
      this.emit();
      waitingForCommit = true;
      j.view.transfer = await this.api.action(
        j.view.sessionId,
        j.view.transfer.id,
        "finish",
        {},
        stop.signal,
      );
      waitingForCommit = false;
      this.check(j.view.transfer, "completed");
      if (
        j.view.transfer.verification !== "sha256" ||
        j.view.transfer.receivedBytes !== j.manifest.size
      )
        throw Error("UPLOAD_RESULT_INVALID");
      j.view.state = "completed";
      j.file = undefined;
      j.manifest = undefined;
    } catch (error) {
      if (j.cancel) {
        if (j.view.transfer) {
          try {
            this.cancellationResult(
              j,
              await this.api.action(
                j.view.sessionId,
                j.view.transfer.id,
                "cancel",
                { cleanup: true },
              ),
            );
          } catch {
            j.view.error = "UPLOAD_CLEANUP_PENDING";
          }
        }
        if (!["skipped", "completed", "unknown"].includes(j.view.state))
          j.view.state = "cancelled";
      } else {
        j.view.error = uploadErrorCode(error);
        j.view.state =
          j.view.transfer?.state === "unknown" || waitingForCommit
            ? "unknown"
            : j.view.transfer?.state === "preview"
              ? "awaiting-review"
              : "failed";
      }
    } finally {
      j.controller = undefined;
      this.emit();
    }
  }
}
export const uploadQueue = new UploadQueue();
