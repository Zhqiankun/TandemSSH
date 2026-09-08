import { randomUUID } from "node:crypto";
import type {
  FileExecutorPort,
  FileOperationGuard,
  OperationContext,
} from "../collaboration/operations/gateway.js";
import type { FileExecutionResult } from "../../types/file-operations.js";
import type {
  FileTransferAction,
  FileTransferResult,
} from "../../types/file-transfer.js";
import type { FileTaskContext } from "./automated-documents.js";
import type { UploadManifest, UploadView } from "../../types/file-upload.js";
import type {
  DownloadSource,
  LocalDownloadView,
} from "../../types/file-download.js";
import { UPLOAD_CHUNK_BYTES } from "../../types/file-upload.js";
import {
  UploadService,
  uploadManifestSchema,
  type UploadTarget,
} from "./upload-service.js";
import { DownloadService } from "./download-service.js";
import type { FilePathLocks } from "./path-locks.js";
export interface TransferTaskContext extends FileTaskContext {
  operationId: string;
  origin: OperationContext["origin"];
}
export interface LocalUploadAccess {
  manifest: UploadManifest;
  read(offset: number, length: number): Promise<Buffer>;
  verify(): Promise<void>;
  close(): void | Promise<void>;
}
export interface LocalDownloadAccess {
  snapshot(): LocalDownloadView;
  start(overwrite: boolean): Promise<LocalDownloadView>;
  append(offset: number, bytes: Buffer): Promise<LocalDownloadView>;
  finish(): Promise<LocalDownloadView>;
  // Close owned handles only; uncertain outcomes and temporary files remain inspectable.
  close(): void | Promise<void>;
}
export interface TaskLocalTransferPort {
  // Metadata-only: must bind user, task, session, direction and local selection version.
  assert(context: TransferTaskContext, action: FileTransferAction): void;
  upload(
    context: TransferTaskContext,
    action: FileTransferAction,
    guard: () => void,
    signal: AbortSignal,
  ): Promise<LocalUploadAccess>;
  download(
    context: TransferTaskContext,
    action: FileTransferAction,
    source: DownloadSource,
    guard: () => void,
    signal: AbortSignal,
  ): Promise<LocalDownloadAccess>;
}
export interface DirectoryBinaryServices {
  uploads: UploadService;
  downloads: DownloadService;
  prepareUpload(
    input: import("../../types/file-upload.js").PrepareUpload,
  ): Promise<UploadView>;
  prepareDownload(
    input: import("../../types/file-download.js").PrepareDownload,
  ): Promise<DownloadSource>;
}
export interface AutomatedTransferPorts {
  directoryServices?: DirectoryBinaryServices;
  local: TaskLocalTransferPort;
  open(
    context: TransferTaskContext,
    guard: FileOperationGuard,
    signal: AbortSignal,
  ): Promise<{ target: UploadTarget; close(): void; beginWrite(): () => void }>;
  audit(
    context: TransferTaskContext,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  locks: FilePathLocks;
}
export interface AutomatedTransferProgress {
  operationId: string;
  taskId: string;
  direction: "upload" | "download";
  state:
    | "preparing"
    | "transferring"
    | "verifying"
    | "succeeded"
    | "failed"
    | "unknown";
  bytes: number;
  totalBytes?: number;
  error?: string;
  result?: FileTransferResult;
}
interface ProgressRecord {
  context: TransferTaskContext;
  view: AutomatedTransferProgress;
  updatedAt: number;
  running: boolean;
  stop: AbortController;
}
const code = (e: unknown) =>
  e instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(e.message)
    ? e.message
    : "FILE_TRANSFER_FAILED";
const sameTask = (a: FileTaskContext, b: FileTaskContext) =>
  a.userId === b.userId && a.taskId === b.taskId && a.sessionId === b.sessionId;
/** Binary transport use case. Native grant authority and public MCP/HTTP are separate adapters. */
export class AutomatedTransfers {
  private records = new Map<string, ProgressRecord>();
  constructor(private ports: AutomatedTransferPorts) {}
  dispose() {
    for (const r of this.records.values()) r.stop.abort();
    this.records.clear();
  }
  progress(context: FileTaskContext, operationId: string) {
    const r = this.records.get(operationId);
    if (!r || !sameTask(r.context, context))
      throw Error("FILE_TRANSFER_NOT_FOUND");
    return structuredClone(r.view);
  }
  forget(context: FileTaskContext, operationId: string) {
    this.progress(context, operationId);
    const r = this.records.get(operationId)!;
    if (
      r.running ||
      r.view.state === "unknown" ||
      r.view.result?.cleanupRequired
    )
      throw Error("FILE_TRANSFER_CLEANUP_PENDING");
    this.records.delete(operationId);
  }
  forgetTask(context: FileTaskContext) {
    const ids = [...this.records]
      .filter(([, r]) => sameTask(r.context, context))
      .map(([id]) => id);
    for (const id of ids) {
      const r = this.records.get(id)!;
      if (
        r.running ||
        r.view.state === "unknown" ||
        r.view.result?.cleanupRequired
      )
        throw Error("FILE_TRANSFER_CLEANUP_PENDING");
    }
    for (const id of ids) this.records.delete(id);
  }
  private reserve(
    context: TransferTaskContext,
    direction: "upload" | "download",
  ) {
    for (const [id, r] of this.records)
      if (
        !r.running &&
        r.view.state !== "unknown" &&
        !r.view.result?.cleanupRequired &&
        Date.now() - r.updatedAt > 15 * 60 * 1000
      )
        this.records.delete(id);
    if (this.records.has(context.operationId))
      throw Error("FILE_TRANSFER_ALREADY_STARTED");
    if (
      this.records.size >= 128 ||
      [...this.records.values()].filter(
        (r) => r.context.userId === context.userId,
      ).length >= 32
    )
      throw Error("FILE_TRANSFER_LIMIT");
    const r: ProgressRecord = {
      context: structuredClone(context),
      view: {
        operationId: context.operationId,
        taskId: context.taskId,
        direction,
        state: "preparing",
        bytes: 0,
      },
      updatedAt: Date.now(),
      running: true,
      stop: new AbortController(),
    };
    this.records.set(context.operationId, r);
    return r;
  }
  executor(
    userId: string,
    sessionId: string,
    fallback?: FileExecutorPort,
  ): FileExecutorPort {
    return {
      prepare: async (action, operationId, operation) => {
        if (action.type !== "file.upload" && action.type !== "file.download") {
          if (!fallback) throw Error("FILE_EXECUTOR_UNAVAILABLE");
          return fallback.prepare(action, operationId, operation);
        }
        const context: TransferTaskContext = {
          userId,
          sessionId,
          operationId,
          taskId: operation.taskId,
          origin: operation.origin,
          control: {
            generation: operation.lease.generation,
            controlEpoch: operation.lease.controlEpoch,
          },
        };
        this.ports.local.assert(context, action);
        let disposed = false,
          record: ProgressRecord | undefined;
        return {
          execute: async (guard) => {
            if (disposed) throw Error("FILE_TRANSFER_CANCELLED");
            guard();
            this.ports.local.assert(context, action);
            record = this.reserve(
              context,
              action.type === "file.upload" ? "upload" : "download",
            );
            return this.execute(record, action, guard);
          },
          dispose: () => {
            disposed = true;
            record?.stop.abort();
          },
        };
      },
    };
  }
  private async execute(
    r: ProgressRecord,
    action: FileTransferAction,
    authority: FileOperationGuard,
  ): Promise<FileExecutionResult> {
    const { context } = r,
      signal = r.stop.signal;
    const guard: FileOperationGuard = (canonical?: string) => {
      if (signal.aborted) throw Error("FILE_TRANSFER_CANCELLED");
      this.ports.local.assert(context, action);
      authority(canonical);
    };
    let opened: Awaited<ReturnType<AutomatedTransferPorts["open"]>> | undefined;
    let uploads: UploadService | undefined,
      downloads: DownloadService | undefined;
    let source: LocalUploadAccess | undefined,
      destination: LocalDownloadAccess | undefined;
    let remoteUpload: UploadView | undefined,
      remoteDownload: DownloadSource | undefined,
      localDownload: LocalDownloadView | undefined;
    let result: FileExecutionResult;
    const transfer = (): FileTransferResult | undefined => {
      if (!remoteUpload && !remoteDownload) return undefined;
      const success =
        action.type === "file.upload"
          ? remoteUpload?.state === "completed" &&
            remoteUpload.verification === "sha256"
          : localDownload?.state === "completed" &&
            localDownload.sha256 === remoteDownload?.sha256;
      return {
        direction: action.type === "file.upload" ? "upload" : "download",
        localGrantId: action.localGrantId,
        localVersion: action.localVersion,
        transferId: remoteUpload?.id ?? remoteDownload!.id,
        bytes: remoteUpload?.receivedBytes ?? localDownload?.writtenBytes ?? 0,
        totalBytes: remoteUpload?.totalBytes ?? remoteDownload!.size,
        verification: success ? "sha256" : "none",
        sha256: success
          ? (remoteUpload?.sha256 ?? localDownload?.sha256)
          : undefined,
        cleanupRequired: !!(
          remoteUpload?.temporaryPath || localDownload?.temporaryPath
        ),
      };
    };
    try {
      guard();
      opened = await this.ports.open(context, guard, signal);
      guard();
      const original = opened.target;
      const target: UploadTarget = {
        ...original,
        check: (access, requested, canonical) => {
          guard(canonical);
          original.check(access, requested, canonical);
        },
      };
      const actor = { userId: context.userId, signal };
      const audit = async (
        _user: string,
        type: string,
        data: Record<string, unknown>,
      ) => {
        guard();
        await this.ports.audit(context, type, data);
        guard();
      };
      if (action.type === "file.upload") {
        source = await this.ports.local.upload(
          context,
          action,
          () => guard(),
          signal,
        );
        guard();
        const manifest = uploadManifestSchema.parse(source.manifest);
        r.view.totalBytes = manifest.size;
        uploads =
          this.ports.directoryServices?.uploads ??
          new UploadService({
            target: async () => {
              guard();
              return target;
            },
            beginWrite: () => {
              guard();
              return opened!.beginWrite();
            },
            audit,
            locks: this.ports.locks,
          });
        const uploadInput = {
          requestId: context.operationId,
          sessionId: context.sessionId,
          path: action.path,
          manifest,
        };
        remoteUpload = this.ports.directoryServices
          ? await this.ports.directoryServices.prepareUpload(uploadInput)
          : await uploads.prepare(actor, uploadInput);
        guard(remoteUpload.canonicalPath);
        remoteUpload = await uploads.start(actor, remoteUpload.id, {
          overwrite: action.overwrite,
          takeover: false,
        });
        if (remoteUpload.state !== "uploading")
          throw Error(remoteUpload.error ?? "FILE_TRANSFER_FAILED");
        r.view.state = "transferring";
        while (remoteUpload.receivedBytes < manifest.size) {
          guard(remoteUpload.canonicalPath);
          const offset = remoteUpload.receivedBytes,
            length = Math.min(UPLOAD_CHUNK_BYTES, manifest.size - offset);
          const bytes = await source.read(offset, length);
          guard();
          if (!Buffer.isBuffer(bytes) || bytes.length !== length)
            throw Error("UPLOAD_SOURCE_CHANGED");
          remoteUpload = await uploads.chunk(
            actor,
            remoteUpload.id,
            offset,
            bytes,
          );
          if (
            remoteUpload.state !== "uploading" ||
            remoteUpload.receivedBytes !== offset + length
          )
            throw Error(remoteUpload.error ?? "UPLOAD_PROGRESS_INVALID");
          r.view.bytes = remoteUpload.receivedBytes;
          r.updatedAt = Date.now();
        }
        await source.verify();
        guard();
        r.view.state = "verifying";
        remoteUpload = await uploads.finish(actor, remoteUpload.id);
        if (
          remoteUpload.state !== "completed" ||
          remoteUpload.verification !== "sha256" ||
          remoteUpload.receivedBytes !== manifest.size
        )
          throw Error(remoteUpload.error ?? "UPLOAD_RESULT_INVALID");
      } else {
        downloads =
          this.ports.directoryServices?.downloads ??
          new DownloadService({
            target: async () => {
              guard();
              return target;
            },
            audit,
          });
        const downloadInput = {
          requestId: randomUUID(),
          sessionId: context.sessionId,
          path: action.path,
        };
        remoteDownload = this.ports.directoryServices
          ? await this.ports.directoryServices.prepareDownload(downloadInput)
          : await downloads.prepare(actor, downloadInput);
        guard(remoteDownload.canonicalPath);
        r.view.totalBytes = remoteDownload.size;
        destination = await this.ports.local.download(
          context,
          action,
          remoteDownload,
          () => guard(remoteDownload!.canonicalPath),
          signal,
        );
        guard();
        localDownload = await destination.start(action.overwrite);
        if (localDownload.state !== "writing")
          throw Error(localDownload.error ?? "DOWNLOAD_RESULT_INVALID");
        r.view.state = "transferring";
        while (localDownload.writtenBytes < remoteDownload.size) {
          guard(remoteDownload.canonicalPath);
          const offset = localDownload.writtenBytes;
          const bytes = await downloads.chunk(actor, remoteDownload.id, offset);
          guard();
          localDownload = await destination.append(offset, bytes);
          if (
            localDownload.state !== "writing" ||
            localDownload.writtenBytes !== offset + bytes.length
          )
            throw Error(localDownload.error ?? "DOWNLOAD_PROGRESS_INVALID");
          r.view.bytes = localDownload.writtenBytes;
          r.updatedAt = Date.now();
        }
        r.view.state = "verifying";
        remoteDownload = await downloads.verify(actor, remoteDownload.id);
        guard(remoteDownload.canonicalPath);
        localDownload = await destination.finish();
        if (
          localDownload.state !== "completed" ||
          localDownload.writtenBytes !== remoteDownload.size ||
          localDownload.sha256 !== remoteDownload.sha256
        )
          throw Error(localDownload.error ?? "DOWNLOAD_RESULT_INVALID");
      }
      const view = transfer()!;
      result = {
        status: "succeeded",
        result: { transfer: view, bytes: view.bytes },
      };
    } catch (error) {
      if (remoteUpload && uploads)
        remoteUpload = uploads.get({ userId: context.userId }, remoteUpload.id);
      let observationLost = false;
      if (destination) {
        try {
          localDownload = destination.snapshot();
        } catch {
          observationLost = true;
        }
      }
      const unknown =
        observationLost ||
        remoteUpload?.state === "unknown" ||
        remoteUpload?.state === "committing" ||
        localDownload?.state === "unknown";
      const view = transfer();
      result = {
        status: unknown ? "unknown" : "failed",
        error: code(error),
        result: view
          ? {
              transfer: view,
              bytes: view.bytes,
              temporaryPath: remoteUpload?.temporaryPath,
              commitMayHaveOccurred: unknown ? true : undefined,
            }
          : undefined,
      };
    } finally {
      // Closing resources never retries, deletes an uncertain target, or declares a partial result successful.
      try {
        await source?.close();
      } catch {
        /* Reported transfer outcome stays authoritative. */
      }
      try {
        await destination?.close();
      } catch {
        /* The native capability retains the cleanup record. */
      }
      if (!this.ports.directoryServices) {
        uploads?.dispose();
        downloads?.dispose();
      }
      try {
        opened?.close();
      } catch {
        /* The accepted file result is independent of channel teardown. */
      }
    }
    r.running = false;
    r.updatedAt = Date.now();
    r.view.state = result.status;
    r.view.error = result.error;
    r.view.result = result.result?.transfer;
    r.view.bytes = result.result?.bytes ?? r.view.bytes;
    return result;
  }
}
