import type {
  RestoredUpload,
  UploadRecoverySummary,
} from "@/types/upload-recovery";
import type {
  ManagedUploadBinding,
  ManagedFileUpload,
  ManagedUploadRecord,
} from "./upload-bindings";
import type { UploadSource } from "@/types/upload-source";
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
  | "suspending"
  | "suspended"
  | "finalizing"
  | "completed"
  | "failed"
  | "unknown"
  | "cancelled"
  | "skipped";
export interface UploadJobView {
  recoveryId?: string;
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
  kind?: "file" | "directory";
  batchId?: string;
  localPath?: string;
}
export interface UploadInput {
  file?: UploadSource;
  name?: string;
  size?: number;
  sessionId: string;
  path: string;
  hostId?: number;
  hostLabel: string;
  kind?: "file" | "directory";
  batchId?: string;
  localPath?: string;
}
interface Job {
  frozen?: boolean;
  preserve?: boolean;
  binding?: ManagedUploadBinding;
  released?: boolean;
  view: UploadJobView;
  file?: UploadSource;
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
  private reserved = 0;
  private epoch = 0;
  private clearing = false;
  private maintaining = false;
  private limit = 2;
  constructor(
    private readonly api: UploadApiPort = uploadApi,
    private readonly resetNative = () =>
      typeof window !== "undefined"
        ? window.electronAPI?.uploadSources?.reset()
        : undefined,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  getConcurrency = () => this.limit;
  getOwner = () => this.owner;
  wake = () => this.drain();
  setOwner(owner: string) {
    if (this.owner && this.owner !== owner) this.resetForSignOut();
    this.owner = owner;
  }
  resetForSignOut() {
    const jobs = [...this.jobs.values()];
    void Promise.resolve(this.resetNative()).catch(() => {});
    this.jobs.clear();
    this.reserved = 0;
    this.epoch++;
    this.owner = undefined;
    for (const j of jobs) {
      j.cancel = true;
      j.preserve = !!j.view.recoveryId;
      j.work = undefined;
      j.controller?.abort();
      j.file = undefined;
      j.manifest = undefined;
      if (!j.controller && j.view.transfer && !j.preserve)
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
  private admit(count: number) {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      this.jobs.size + this.reserved + count > 4096
    )
      throw Error("UPLOAD_LIMIT");
  }
  add(input: UploadInput & { file: UploadSource }) {
    this.admit(1);
    return this.create(input);
  }
  private create(
    input: UploadInput,
    binding?: ManagedUploadBinding,
    state: UploadQueueState = "queued",
    notify = true,
  ) {
    const id = crypto.randomUUID();
    this.jobs.set(id, {
      view: {
        id,
        name: input.name ?? input.file?.name ?? "",
        size: input.size ?? input.file?.size ?? 0,
        path: input.path,
        sessionId: input.sessionId,
        hostId: input.hostId,
        hostLabel: input.hostLabel,
        kind: input.kind,
        batchId: input.batchId,
        localPath: input.localPath,
        state,
        sourceCheckedBytes: 0,
      },
      file: input.file,
      binding,
      work:
        binding?.kind === "record" || state !== "queued"
          ? undefined
          : "prepare",
      requestId: crypto.randomUUID(),
      overwrite: binding?.kind === "file" ? binding.overwrite : false,
      takeover: binding?.kind === "file" ? binding.takeover : false,
      pause: false,
      cancel: false,
      startedAt: 0,
      startBytes: 0,
    });
    if (notify) {
      this.emit();
      this.drain();
    }
    return id;
  }
  reserve(count: number) {
    if (!this.owner) throw Error("UPLOAD_OWNER_REQUIRED");
    this.admit(count);
    this.reserved += count;
    let remaining = count;
    const epoch = this.epoch;
    const take = () => {
      if (epoch !== this.epoch || !remaining) throw Error("UPLOAD_CANCELLED");
      remaining--;
      this.reserved--;
    };
    return {
      file: (
        input: UploadInput & { file: UploadSource },
        binding: ManagedFileUpload,
      ) => {
        take();
        return this.create(input, binding, "queued", false);
      },
      record: (
        input: UploadInput,
        binding: ManagedUploadRecord,
        state: UploadQueueState = "queued",
      ) => {
        take();
        return this.create(input, binding, state, false);
      },
      close: () => {
        if (epoch === this.epoch) this.reserved -= remaining;
        remaining = 0;
        this.emit();
        this.drain();
      },
    };
  }
  updateRecord(
    id: string,
    change: Pick<UploadJobView, "state" | "error">,
    notify = true,
  ) {
    const j = this.jobs.get(id);
    if (!j || j.binding?.kind !== "record") return;
    Object.assign(j.view, change);
    if (notify) this.emit();
  }
  private job(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw Error("UPLOAD_NOT_FOUND");
    return job;
  }
  start(id: string, overwrite: boolean, takeover = false) {
    const j = this.job(id);
    if (j.frozen) return;
    if (j.view.state !== "awaiting-review") return;
    j.overwrite = j.binding?.kind === "file" ? j.binding.overwrite : overwrite;
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
    if (j.frozen) return;
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
  async repreview(
    id: string,
    name?: string,
    sessionId?: string,
    takeover = false,
  ) {
    const j = this.job(id);
    if (j.frozen) throw Error("UPLOAD_BUSY");
    if (j.binding?.kind === "record") {
      if (j.view.state === "failed") await j.binding.retry?.(takeover);
      return;
    }
    if (j.binding && name) throw Error("UPLOAD_TREE_REVIEW_REQUIRED");
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
    await this.forgetTransfer(j);
    if (this.jobs.get(id) !== j) return;
    if (j.binding) j.takeover = takeover;
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
    j.view.recoveryId = undefined;
    j.view.transfer = undefined;
    j.released = false;
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
  async quiesce(ids: string[]) {
    const jobs = ids.flatMap((id) =>
        this.jobs.get(id) ? [this.jobs.get(id)!] : [],
      ),
      epoch = this.epoch;
    for (const j of jobs) {
      j.frozen = true;
      if (j.view.state === "uploading") {
        j.pause = true;
        j.view.state = "pausing";
      }
    }
    this.emit();
    if (jobs.some((j) => j.controller))
      await new Promise<void>((resolve) => {
        const off = this.subscribe(() => {
          if (
            jobs.every((j) => !j.controller || this.jobs.get(j.view.id) !== j)
          ) {
            off();
            resolve();
          }
        });
      });
    if (epoch !== this.epoch) throw Error("UPLOAD_CANCELLED");
    try {
      for (const j of jobs) {
        if (j.view.state === "completed") {
          await this.forgetTransfer(j);
          continue;
        }
        if (
          j.view.transfer?.temporaryPath &&
          !["unknown", "completed", "cancelled"].includes(j.view.transfer.state)
        ) {
          const view = await this.api.action(
            j.view.sessionId,
            j.view.transfer.id,
            "pause",
          );
          j.view.transfer = view;
          if (view.state === "completed") {
            this.cancellationResult(j, view);
            await this.forgetTransfer(j);
            continue;
          }
          if (view.state !== "paused" && view.state !== "unknown")
            throw Error(view.error ?? "UPLOAD_STATE_INVALID");
          j.view.state = view.state;
          j.work = undefined;
        }
      }
    } catch (error) {
      this.unfreeze(ids);
      throw error;
    }
    this.emit();
    return jobs.map((j) => structuredClone(j.view));
  }
  unfreeze(ids: string[]) {
    for (const id of ids) {
      const j = this.jobs.get(id);
      if (j) j.frozen = false;
    }
    this.emit();
    this.drain();
  }
  releaseSaved(ids: string[]) {
    for (const id of ids) {
      const j = this.jobs.get(id);
      if (j?.controller) throw Error("UPLOAD_BUSY");
      if (j) {
        j.preserve = true;
        j.file = undefined;
        j.manifest = undefined;
        this.jobs.delete(id);
      }
    }
    this.emit();
  }
  adoptBatch(
    id: string,
    recordId: string,
    state: UploadQueueState,
    view?: UploadView,
    manifest?: UploadManifest,
  ) {
    const j = this.job(id);
    j.view.recoveryId = recordId;
    j.view.state = state;
    j.view.transfer = view;
    j.manifest = manifest;
    j.work = state === "queued" ? "prepare" : undefined;
    j.pause = state === "paused";
    j.preserve = true;
  }
  completeRecord(id: string, view: UploadView) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.view.state = "completed";
    j.view.transfer = view;
    j.view.error = undefined;
    j.file = undefined;
    j.manifest = undefined;
    this.emit();
  }
  async suspend(
    id: string,
    persist: (id: string) => Promise<UploadRecoverySummary>,
  ) {
    const j = this.job(id);
    if (
      j.binding ||
      j.controller ||
      j.view.state !== "paused" ||
      !j.view.transfer
    )
      throw Error("UPLOAD_STATE_INVALID");
    j.view.state = "suspending";
    this.emit();
    try {
      const record = await persist(j.view.transfer.id);
      if (this.jobs.get(id) !== j || j.cancel) throw Error("UPLOAD_CANCELLED");
      j.view.state = "suspended";
      j.view.recoveryId = record.id;
      j.view.transfer = undefined;
      j.file = undefined;
      j.manifest = undefined;
      j.view.error = undefined;
    } catch (e) {
      if (this.jobs.get(id) === j) {
        j.view.state = "paused";
        j.view.error = uploadErrorCode(e);
      }
      throw e;
    } finally {
      this.emit();
    }
  }
  reserveRecovery() {
    if (!this.owner) throw Error("UPLOAD_OWNER_REQUIRED");
    this.admit(1);
    this.reserved++;
    const epoch = this.epoch;
    let used = false;
    const close = () => {
      if (!used) {
        used = true;
        if (epoch === this.epoch) this.reserved--;
      }
    };
    return {
      close,
      accept: (result: RestoredUpload, file: UploadSource, hostId?: number) => {
        if (used || epoch !== this.epoch) throw Error("UPLOAD_CANCELLED");
        if (result.view.state !== "paused")
          throw Error("UPLOAD_RESULT_INVALID");
        close();
        const id = this.create(
            {
              file,
              sessionId: result.view.sessionId,
              path: result.view.path,
              hostId,
              hostLabel: result.view.hostIdentity ?? "SSH",
            },
            undefined,
            "paused",
            false,
          ),
          j = this.job(id);
        j.manifest = result.manifest;
        j.view.transfer = result.view;
        j.view.recoveryId = result.summary.id;
        this.emit();
        return id;
      },
    };
  }
  reconcileRecovery(id: string, view?: UploadView) {
    if (!view || view.state !== "completed") return;
    const j = [...this.jobs.values()].find(
      (j) => j.view.recoveryId === id && j.view.transfer?.id === view.id,
    );
    if (j) {
      j.view.transfer = view;
      j.view.state = "completed";
      j.view.error = undefined;
      j.file = undefined;
      j.manifest = undefined;
      this.emit();
    }
  }
  async cancel(id: string, skip = false) {
    const j = this.job(id);
    if (j.frozen) return;
    if (
      [
        "completed",
        "unknown",
        "finalizing",
        "suspended",
        "suspending",
      ].includes(j.view.state)
    )
      return;
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
  private async forgetTransfer(j: Job) {
    if (!j.view.transfer || j.released) return;
    if (
      !["completed", "cancelled"].includes(j.view.transfer.state) ||
      j.view.transfer.temporaryPath
    )
      throw Error("UPLOAD_CLEANUP_PENDING");
    if (
      j.view.transfer.state === "completed" &&
      j.binding?.kind === "file" &&
      j.binding.completed
    ) {
      try {
        await j.binding.completed(j.view.transfer.id);
      } catch (error) {
        throw Error("UPLOAD_TREE_RECEIPT_PENDING", { cause: error });
      }
    }
    try {
      await this.api.action(j.view.sessionId, j.view.transfer.id, "forget");
    } catch (error) {
      if (uploadErrorCode(error) !== "UPLOAD_NOT_FOUND") throw error;
    }
    j.released = true;
  }
  async removeFinished() {
    if (this.clearing) return;
    this.clearing = true;
    try {
      for (const [id, j] of this.jobs) {
        if (
          !["completed", "cancelled", "skipped", "suspended"].includes(
            j.view.state,
          ) ||
          j.controller ||
          j.frozen ||
          j.view.transfer?.temporaryPath
        )
          continue;
        try {
          await this.forgetTransfer(j);
          if (this.jobs.get(id) !== j) continue;
          await j.binding?.release();
          if (this.jobs.get(id) === j) this.jobs.delete(id);
        } catch (error) {
          if (this.jobs.get(id) === j) j.view.error = uploadErrorCode(error);
        }
      }
    } finally {
      this.clearing = false;
      this.emit();
    }
  }
  async maintain() {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      for (const j of this.jobs.values()) {
        if (
          !j.view.transfer ||
          j.released ||
          j.controller ||
          ["completed", "cancelled", "skipped", "unknown"].includes(
            j.view.state,
          )
        )
          continue;
        try {
          await this.api.action(j.view.sessionId, j.view.transfer.id, "touch");
        } catch (error) {
          if (this.jobs.get(j.view.id) === j)
            j.view.error = uploadErrorCode(error);
        }
      }
    } finally {
      this.maintaining = false;
      this.emit();
    }
  }
  private check(view: UploadView, state: UploadView["state"]) {
    if (view.state !== state)
      throw Error(view.error ?? "UPLOAD_RESULT_INVALID");
  }
  private drain() {
    while (this.active < this.limit) {
      const j = [...this.jobs.values()].find(
        (j) =>
          j.work &&
          !j.frozen &&
          (j.binding?.kind !== "file" || j.binding.ready()),
      );
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
        j.view.transfer =
          j.binding?.kind === "file"
            ? await j.binding.prepare(
                j.requestId,
                j.view.sessionId,
                j.manifest!,
                stop.signal,
              )
            : await this.api.prepare(
                {
                  sessionId: j.view.sessionId,
                  path: j.view.path,
                  manifest: j.manifest!,
                  requestId: j.requestId,
                },
                stop.signal,
              );
        this.check(j.view.transfer, "preview");
        if (j.binding?.kind !== "file") {
          j.view.state = "awaiting-review";
          return;
        }
        if (j.cancel) throw Error("UPLOAD_CANCELLED");
      }
      if (!j.view.transfer || !j.manifest)
        throw Error("UPLOAD_PREVIEW_REQUIRED");
      if (j.frozen || (j.binding?.kind === "file" && !j.binding.ready())) {
        j.work = work === "prepare" ? "upload" : work;
        j.view.state = j.view.transfer.temporaryPath ? "paused" : "queued";
        return;
      }
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
          blob = await j.file.slice(offset, end);
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
      await j.file.verify?.();
      if (j.cancel) throw Error("UPLOAD_CANCELLED");
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
      try {
        await this.forgetTransfer(j);
      } catch (error) {
        j.view.error = uploadErrorCode(error);
      }
    } catch (error) {
      if (j.cancel) {
        if (j.view.transfer && !j.preserve) {
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
            : j.view.transfer?.state === "preview" && !j.binding
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
