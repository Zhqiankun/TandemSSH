import { randomUUID, createHash } from "node:crypto";
import { posix } from "node:path";
import {
  AutomatedTransfers,
  type AutomatedTransferPorts,
  type TransferTaskContext,
} from "./automated-transfers.js";
import {
  UploadService,
  type UploadPorts,
  type UploadTarget,
} from "./upload-service.js";
import { DownloadService } from "./download-service.js";
import { UploadTreeService } from "./upload-tree-service.js";
import { DownloadTreeService } from "./download-tree-service.js";
import type { LocalFileGrants } from "./local-file-grants.js";
import type { FileTaskContext } from "./automated-documents.js";
import type {
  FileExecutorPort,
  FileOperationGuard,
  OperationContext,
} from "../collaboration/operations/gateway.js";
import type { FileExecutionResult } from "../../types/file-operations.js";
import {
  isDirectoryAction,
  type DirectoryAction,
  type DirectoryEntryView,
  type DirectoryPreviewView,
  type DirectoryResult,
} from "../../types/directory-transfer.js";
import type { UploadTreePreview } from "../../types/upload-tree.js";
import type {
  DownloadTreePreview,
  LocalDownloadTreePreview,
} from "../../types/download-tree.js";
type Entry = DirectoryEntryView & {
  sourceId: string;
  lastModified: number;
  resultData?: FileExecutionResult;
  binary?: AutomatedTransfers;
};
type Scope = {
  context: TransferTaskContext;
  operation: OperationContext;
  guard: FileOperationGuard;
  signal: AbortSignal;
  active: boolean;
  target: UploadTarget;
  close: () => void;
};
interface Record {
  context: FileTaskContext;
  action: Extract<DirectoryAction, { type: "file.directory.preview" }>;
  view: DirectoryPreviewView;
  entries: Map<string, Entry>;
  rootCanonical: string;
  busy: boolean;
  previewFinished: boolean;
  holders: Set<object>;
  scope?: Scope;
  stop?: AbortController;
  uploads: UploadService;
  downloads: DownloadService;
  uploadTrees: UploadTreeService;
  downloadTrees: DownloadTreeService;
  upload?: UploadTreePreview;
  download?: DownloadTreePreview;
  local?: LocalDownloadTreePreview;
  choicesDigest?: string;
}
const code = (e: unknown) =>
  e instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(e.message)
    ? e.message
    : "DIRECTORY_TRANSFER_FAILED";
const identity = (a: FileTaskContext, b: FileTaskContext) =>
  a.userId === b.userId && a.taskId === b.taskId && a.sessionId === b.sessionId;
/** Directory previews own immutable mappings; every execution receives a fresh, bounded gateway scope. */
export class DirectoryTransfers {
  private records = new Map<string, Record>();
  private preparing = 0;
  private closed = false;
  constructor(
    private grants: LocalFileGrants,
    private ports: Omit<AutomatedTransferPorts, "local" | "directoryServices">,
  ) {}
  private owned(ctx: FileTaskContext, id: string, execute = false) {
    const r = this.records.get(id);
    if (!r || !identity(ctx, r.context))
      throw Error("DIRECTORY_PREVIEW_NOT_FOUND");
    if (
      execute &&
      (r.context.control.generation !== ctx.control.generation ||
        r.view.expiresAt < Date.now())
    )
      throw Error("DIRECTORY_PREVIEW_EXPIRED");
    return r;
  }
  private assert(r: Record, c: TransferTaskContext, a: DirectoryAction) {
    this.owned(c, r.view.id, true);
    this.grants.assertDirectory(c, {
      localGrantId: a.localGrantId,
      localVersion: a.localVersion,
      direction: a.direction,
      overwrite: a.overwrite,
    });
    if (
      a.localGrantId !== r.action.localGrantId ||
      a.localVersion !== r.action.localVersion ||
      a.direction !== r.action.direction ||
      a.overwrite !== r.action.overwrite ||
      ("revision" in a && a.revision !== r.view.revision)
    )
      throw Error("DIRECTORY_PREVIEW_CHANGED");
    if (a.type === "file.directory.entry") {
      const e = r.entries.get(a.entryId);
      if (
        !e ||
        e.kind === "excluded" ||
        e.path !== a.path ||
        a.rootPath !== r.action.path ||
        a.canonicalRoot !== r.rootCanonical
      )
        throw Error("FILE_DIRECTORY_ENTRY_INVALID");
    } else if (a.path !== r.action.path)
      throw Error("DIRECTORY_PREVIEW_CHANGED");
  }
  private current(r: Record) {
    const s = r.scope;
    if (!s || !s.active || s.signal.aborted)
      throw Error("DIRECTORY_SCOPE_CLOSED");
    s.guard();
    return s;
  }
  private create(
    ctx: TransferTaskContext,
    a: Extract<DirectoryAction, { type: "file.directory.preview" }>,
  ): Record {
    const r = {} as Record;
    const scoped: UploadPorts = {
      locks: this.ports.locks,
      target: async (user, session) => {
        const s = this.current(r);
        if (user !== s.context.userId || session !== s.context.sessionId)
          throw Error("FILE_SESSION_UNAVAILABLE");
        return s.target;
      },
      beginWrite: () => {
        this.current(r);
        return () => {};
      },
      audit: async (_user, type, data) => {
        const s = this.current(r);
        await this.ports.audit(s.context, type, data);
        if (r.scope !== s || !s.active) throw Error("DIRECTORY_SCOPE_CLOSED");
        s.guard();
      },
    };
    r.context = structuredClone(ctx);
    r.action = structuredClone(a);
    r.entries = new Map();
    r.rootCanonical = "";
    r.busy = false;
    r.previewFinished = false;
    r.holders = new Set();
    r.uploads = new UploadService(scoped);
    r.downloads = new DownloadService(scoped);
    r.uploadTrees = new UploadTreeService(scoped, r.uploads);
    r.downloadTrees = new DownloadTreeService(scoped, r.downloads);
    r.view = {
      id: randomUUID(),
      revision: randomUUID(),
      taskId: ctx.taskId,
      direction: a.direction,
      overwrite: a.overwrite,
      renames: a.renames ? structuredClone(a.renames) : undefined,
      timeoutMs: a.timeoutMs,
      path: a.path,
      localGrantId: a.localGrantId,
      localVersion: a.localVersion,
      state: "preview",
      entries: 0,
      files: 0,
      directories: 0,
      excluded: 0,
      totalBytes: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60000,
    };
    return r;
  }
  private async scope<T>(
    r: Record,
    c: TransferTaskContext,
    a: DirectoryAction,
    guard: FileOperationGuard,
    stop: AbortController,
    work: () => Promise<T>,
    operation: OperationContext,
  ) {
    if (r.busy) throw Error("DIRECTORY_OPERATION_IN_PROGRESS");
    if (!guard.checkDirectoryPath) throw Error("DIRECTORY_GATEWAY_REQUIRED");
    r.busy = true;
    r.stop = stop;
    const signal = stop.signal;
    let opened: Awaited<ReturnType<AutomatedTransferPorts["open"]>> | undefined;
    try {
      guard();
      this.grants.assertDirectory(c, a);
      opened = await this.ports.open(c, () => guard(), signal);
      guard();
      const root = await opened.target.io.resolve(r.action.path);
      guard();
      if (r.rootCanonical && r.rootCanonical !== root)
        throw Error("FILE_TARGET_CHANGED");
      r.rootCanonical = root;
      guard(a.type === "file.directory.entry" ? a.path : root);
      const nativeTarget = opened.target;
      const s: Scope = {
        context: c,
        operation: structuredClone(operation),
        signal,
        guard,
        active: true,
        close: opened.close,
        target: {
          ...nativeTarget,
          check: (access, requested, canonical) => {
            if (!s.active || r.scope !== s || signal.aborted)
              throw Error("DIRECTORY_SCOPE_CLOSED");
            guard.checkDirectoryPath!(requested, canonical, access);
            nativeTarget.check(access, requested, canonical);
          },
          retain: () => () => {},
        },
      };
      r.scope = s;
      r.view.expiresAt = Date.now() + 30 * 60000;
      return await work();
    } finally {
      if (r.scope) {
        r.scope.active = false;
        r.scope = undefined;
      }
      opened?.close();
      r.busy = false;
      r.stop = undefined;
    }
  }
  private result(
    r: Record,
    phase: DirectoryResult["phase"],
    e?: Entry,
  ): DirectoryResult {
    return {
      previewId: r.view.id,
      revision: r.view.revision,
      direction: r.view.direction,
      phase,
      entries: r.view.entries,
      files: r.view.files,
      directories: r.view.directories,
      excluded: r.view.excluded,
      totalBytes: r.view.totalBytes,
      ...(e
        ? { entryId: e.id, entryKind: e.kind as "file" | "directory" }
        : {}),
    };
  }
  private renamed(
    a: Extract<DirectoryAction, { type: "file.directory.preview" }>,
    entries: Array<{ id: string; relativePath: string; name: string }>,
  ) {
    const renames = new Map<string, string>();
    for (const x of a.renames ?? []) {
      if (
        renames.has(x.relativePath) ||
        !entries.some((e) => e.relativePath === x.relativePath)
      )
        throw Error("FILE_DIRECTORY_ENTRY_INVALID");
      renames.set(x.relativePath, x.name);
    }
    return (e: { relativePath: string; name: string }) =>
      renames.get(e.relativePath) ?? e.name;
  }
  private recount(r: Record) {
    const entries = [...r.entries.values()];
    r.view.entries = entries.length;
    r.view.files = entries.filter((e) => e.kind === "file").length;
    r.view.directories = entries.filter((e) => e.kind === "directory").length;
    r.view.excluded = entries.filter((e) => e.kind === "excluded").length;
    r.view.totalBytes = entries.reduce(
      (n, e) => n + (e.kind === "file" ? e.size : 0),
      0,
    );
    if (
      !Number.isSafeInteger(r.view.totalBytes) ||
      entries.length > 4096 ||
      Buffer.byteLength(JSON.stringify(entries)) > 2 * 1024 * 1024
    )
      throw Error("DIRECTORY_PREVIEW_LIMIT");
  }
  private async preview(r: Record) {
    const s = this.current(r),
      local = this.grants.directory(
        s.context,
        r.action,
        () => s.guard(),
        s.signal,
      );
    if (r.action.direction === "upload") {
      const source = local.uploadEntries(),
        rename = this.renamed(r.action, source),
        valid = source.filter(
          (e) => (e.kind === "file" || e.kind === "directory") && !e.error,
        );
      r.upload = await r.uploadTrees.preview(
        { userId: s.context.userId, signal: s.signal },
        {
          sessionId: s.context.sessionId,
          path: r.action.path,
          entries: valid.map((e) => ({
            id: e.id,
            parentId: e.parentId,
            name: rename(e),
            kind: e.kind as "file" | "directory",
            size: e.size,
            lastModified: e.lastModified,
          })),
        },
      );
      for (const e of r.upload.entries) {
        const original = source.find((x) => x.id === e.id)!;
        r.entries.set(e.id, {
          id: e.id,
          parentId: e.parentId,
          relativePath: e.relativePath,
          sourceRelativePath: original.relativePath,
          path: e.path,
          kind: e.kind,
          size: e.size,
          status: e.status,
          error: e.error,
          sourceId: e.id,
          lastModified: original.lastModified,
        });
      }
      for (const e of source.filter(
        (e) => e.error || !["file", "directory"].includes(e.kind),
      ))
        r.entries.set(e.id, {
          id: e.id,
          parentId: e.parentId,
          relativePath: e.relativePath,
          sourceRelativePath: e.relativePath,
          path: posix.join(r.rootCanonical, e.relativePath),
          kind: "excluded",
          size: 0,
          status: "blocked",
          error: e.error ?? "UPLOAD_SOURCE_LINK_OR_SPECIAL",
          sourceId: e.id,
          lastModified: e.lastModified,
        });
    } else {
      r.download = await r.downloadTrees.scan(
        { userId: s.context.userId, signal: s.signal },
        { sessionId: s.context.sessionId, paths: [r.action.path] },
      );
      if (
        !r.download.entries.some(
          (e) => !e.parentId && e.kind === "directory" && !e.error,
        )
      )
        throw Error("FILE_LOCAL_DIRECTORY_REQUIRED");
      const rename = this.renamed(r.action, r.download.entries),
        valid = r.download.entries.filter(
          (e) => !e.error && (e.kind === "file" || e.kind === "directory"),
        );
      r.local = await local.previewDownload(
        valid.map((e) => ({
          id: e.id,
          parentId: e.parentId,
          name: rename(e),
          kind: e.kind as "file" | "directory",
          size: e.kind === "file" ? e.size : 0,
        })),
      );
      for (const e of r.local.entries) {
        const original = r.download.entries.find((x) => x.id === e.id)!;
        r.entries.set(e.id, {
          id: e.id,
          parentId: e.parentId,
          relativePath: e.relativePath,
          sourceRelativePath: original.relativePath,
          path: original.path,
          kind: e.kind,
          size: e.size,
          status: e.status,
          error: e.error,
          sourceId: e.id,
          lastModified: original.modifiedAt,
        });
      }
      for (const e of r.download.entries.filter(
        (e) => e.error || !["file", "directory"].includes(e.kind),
      ))
        r.entries.set(e.id, {
          id: e.id,
          parentId: e.parentId,
          relativePath: e.relativePath,
          sourceRelativePath: e.relativePath,
          path: e.path,
          kind: "excluded",
          size: 0,
          status: "blocked",
          error: e.error ?? "DOWNLOAD_TREE_SPECIAL_SKIPPED",
          sourceId: e.id,
          lastModified: e.modifiedAt,
        });
    }
    for (const e of [...r.entries.values()].sort(
      (a, b) =>
        a.relativePath.split("/").length - b.relativePath.split("/").length,
    )) {
      if (e.kind === "excluded") continue;
      if (e.parentId && r.entries.get(e.parentId)?.status === "blocked") {
        e.status = "blocked";
        e.error = "FILE_DIRECTORY_PARENT_UNAVAILABLE";
        continue;
      }
      try {
        s.target.check(
          r.action.direction === "upload" ? "write" : "read",
          e.path,
          e.path,
        );
      } catch (error) {
        s.guard();
        const errorCode = code(error);
        if (!["POLICY_DENIED", "FILE_SCOPE_EXCEEDED"].includes(errorCode))
          throw error;
        e.status = "blocked";
        e.error = errorCode;
      }
    }
    this.recount(r);
    s.guard();
    r.previewFinished = true;
    return {
      status: "succeeded" as const,
      result: { directoryTransfer: this.result(r, "preview") },
    };
  }
  private async confirm(
    r: Record,
    a: Extract<DirectoryAction, { type: "file.directory.confirm" }>,
  ) {
    if (
      a.requireAllAllowed &&
      [...r.entries.values()].some(
        (e) => e.kind !== "excluded" && e.status === "blocked",
      )
    )
      return { status: "failed" as const, error: "DIRECTORY_BLOCKED" };
    if (
      a.stopOnConflict &&
      [...r.entries.values()].some((e) => e.status === "conflict")
    )
      return { status: "failed" as const, error: "DIRECTORY_CONFLICT" };
    const s = this.current(r),
      digest = createHash("sha256")
        .update(
          JSON.stringify(
            [...a.choices].sort((a, b) => a.id.localeCompare(b.id)),
          ),
        )
        .digest("hex");
    if (r.choicesDigest) {
      if (r.choicesDigest !== digest) throw Error("DIRECTORY_PREVIEW_CHANGED");
      return {
        status: "succeeded" as const,
        result: { directoryTransfer: this.result(r, "confirmed") },
      };
    }
    const choices = new Map(a.choices.map((e) => [e.id, e.action]));
    if (
      choices.size !== r.entries.size ||
      choices.size !== a.choices.length ||
      [...choices.keys()].some((id) => !r.entries.has(id))
    )
      throw Error("FILE_DIRECTORY_ENTRY_INVALID");
    if (!a.overwrite && a.choices.some((e) => e.action === "overwrite"))
      throw Error("FILE_LOCAL_OVERWRITE_REQUIRED");
    for (const e of r.entries.values())
      if (e.kind === "excluded" && choices.get(e.id) !== "skip")
        throw Error("FILE_DIRECTORY_ENTRY_INVALID");
    for (const e of r.entries.values())
      if (e.status === "blocked" && choices.get(e.id) !== "skip")
        throw Error("POLICY_DENIED");
    const decisions = a.choices.filter(
      (e) => r.entries.get(e.id)!.kind !== "excluded",
    );
    if (r.upload) {
      r.upload = await r.uploadTrees.confirm(
        { userId: s.context.userId, signal: s.signal },
        r.upload.id,
        r.upload.revision,
        decisions,
      );
      for (const e of r.upload.entries) r.entries.get(e.id)!.action = e.action;
    } else {
      const local = this.grants.directory(
        s.context,
        a,
        () => s.guard(),
        s.signal,
      );
      r.local = local.confirmDownload(
        r.local!.id,
        r.local!.revision,
        decisions,
      );
      for (const e of r.local.entries) r.entries.get(e.id)!.action = e.action;
    }
    for (const e of r.entries.values())
      if (e.kind === "excluded") e.action = "skip";
    r.choicesDigest = digest;
    r.view.state = "confirmed";
    return {
      status: "succeeded" as const,
      result: { directoryTransfer: this.result(r, "confirmed") },
    };
  }
  private async entry(
    r: Record,
    a: Extract<DirectoryAction, { type: "file.directory.entry" }>,
  ): Promise<FileExecutionResult> {
    const s = this.current(r),
      e = r.entries.get(a.entryId)!;
    if (
      r.view.state !== "confirmed" ||
      !e.action ||
      e.action === "skip" ||
      e.status === "blocked"
    )
      throw Error("DIRECTORY_NOT_CONFIRMED");
    e.operationId = s.context.operationId;
    if (e.resultData?.status === "succeeded")
      return structuredClone(e.resultData);
    if (
      e.resultData?.status === "unknown" ||
      e.resultData?.result?.transfer?.cleanupRequired
    )
      throw Error("FILE_DIRECTORY_RESULT_UNKNOWN");
    const local = this.grants.directory(
      s.context,
      a,
      () => s.guard(e.path),
      s.signal,
    );
    let result: FileExecutionResult;
    if (e.kind === "directory") {
      let state: "created" | "merged" | "skipped" | "failed" | "unknown",
        error: string | undefined;
      if (r.upload) {
        const rows = await r.uploadTrees.directories(
          { userId: s.context.userId, signal: s.signal },
          r.upload.id,
          false,
          e.id,
        );
        state = rows[0].state;
        error = rows[0].error;
      } else {
        try {
          const rows = await local.createDownloadDirectories(
            r.local!.id,
            (type, data) => this.ports.audit(s.context, type, data),
            () => s.guard(e.path),
            e.id,
          );
          state = rows[0].state as typeof state;
          error = rows[0].error;
        } catch (caught) {
          const view = this.grants
            .directoryState(s.context, a.localGrantId, r.local!.id)
            .entries.find((x) => x.id === e.id);
          state = view?.result?.state === "unknown" ? "unknown" : "failed";
          error = code(caught);
        }
      }
      result = {
        status:
          state === "unknown"
            ? "unknown"
            : state === "failed"
              ? "failed"
              : "succeeded",
        error,
        result: {
          directoryTransfer: {
            ...this.result(r, "entry", e),
            entryState: state,
          },
          ...(state === "unknown" ? { commitMayHaveOccurred: true } : {}),
        },
      };
    } else {
      const binary = new AutomatedTransfers({
        ...this.ports,
        local: {
          assert: (c) => {
            this.assert(r, c, a);
          },
          upload: () => local.uploadFile(e.sourceId),
          download: (_c, _a, source) =>
            local.downloadFile(r.local!.id, e.sourceId, source),
        },
        open: async () => ({
          target: s.target,
          close: () => {},
          beginWrite: () => () => {},
        }),
        directoryServices: {
          uploads: r.uploads,
          downloads: r.downloads,
          prepareUpload: (input) =>
            r.uploadTrees.prepareEntry(
              { userId: s.context.userId, signal: s.signal },
              r.upload!.id,
              e.sourceId,
              s.context.sessionId,
              input.requestId,
              input.manifest,
            ),
          prepareDownload: (input) =>
            r.downloadTrees.prepareEntry(
              { userId: s.context.userId, signal: s.signal },
              r.download!.id,
              e.sourceId,
              input.requestId,
              s.context.sessionId,
            ),
        },
      });
      e.binary = binary;
      const prepared = await binary
        .executor(s.context.userId, s.context.sessionId)
        .prepare(
          {
            type: a.direction === "upload" ? "file.upload" : "file.download",
            path: e.path,
            localGrantId: a.localGrantId,
            localVersion: a.localVersion,
            overwrite: e.action === "overwrite",
            timeoutMs: a.timeoutMs,
          },
          s.context.operationId,
          s.operation,
        );
      try {
        result = await prepared.execute((canonical) => {
          s.guard(canonical ?? e.path);
        });
      } finally {
        prepared.dispose();
      }
      result = {
        ...result,
        result: {
          ...result.result,
          directoryTransfer: {
            ...this.result(r, "entry", e),
            entryState: result.status,
          },
        },
      };
      if (result.status === "succeeded" && result.result?.transfer) {
        try {
          if (a.direction === "upload")
            r.uploads.forget(
              { userId: s.context.userId },
              result.result.transfer.transferId,
            );
          else
            r.downloads.forget(
              { userId: s.context.userId },
              result.result.transfer.transferId,
            );
        } catch {
          /* Keep bounded service records when cleanup cannot be verified. */
        }
        binary.dispose();
        e.binary = undefined;
      }
    }
    e.resultData = structuredClone(result);
    e.result = {
      status: result.status,
      error: result.error,
      transfer: result.result?.transfer,
      state: result.result?.directoryTransfer?.entryState,
    };
    return result;
  }
  async pruneExpired() {
    let removed = 0;
    for (const r of [...this.records.values()])
      if (
        !r.view.assigned &&
        !r.busy &&
        !r.holders.size &&
        r.view.expiresAt <= Date.now()
      ) {
        try {
          await this.release(r.context, r.view.id);
          removed++;
        } catch {
          /* Preserve resources when cleanup cannot be verified. */
        }
      }
    return removed;
  }
  executor(
    userId: string,
    sessionId: string,
    fallback?: FileExecutorPort,
  ): FileExecutorPort {
    return {
      prepare: async (action, operationId, operation) => {
        if (!isDirectoryAction(action)) {
          if (!fallback) throw Error("FILE_EXECUTOR_UNAVAILABLE");
          return fallback.prepare(action, operationId, operation);
        }
        const c: TransferTaskContext = {
          userId,
          sessionId,
          taskId: operation.taskId,
          operationId,
          origin: operation.origin,
          control: {
            generation: operation.lease.generation,
            controlEpoch: operation.lease.controlEpoch,
          },
        };
        this.grants.assertDirectory(c, action);
        let disposed = false;
        const stop = new AbortController();
        return {
          execute: async (guard) => {
            if (this.closed || disposed)
              throw Error("DIRECTORY_TRANSFER_CANCELLED");
            let r: Record;
            if (action.type === "file.directory.preview") {
              await this.pruneExpired();
              if (
                this.preparing >= 2 ||
                this.records.size + this.preparing >= 16 ||
                [...this.records.values()].filter(
                  (r) => r.context.userId === userId,
                ).length >= 4
              )
                throw Error("DIRECTORY_PREVIEW_LIMIT");
              this.preparing++;
              r = this.create(c, action);
              this.records.set(r.view.id, r);
              try {
                return await this.scope(
                  r,
                  c,
                  action,
                  guard,
                  stop,
                  () => this.preview(r),
                  operation,
                );
              } catch (error) {
                if (r.local) {
                  await this.grants
                    .cancelDirectoryPreview(c, action.localGrantId, r.local.id)
                    .catch(() => {});
                  try {
                    this.grants.forgetDirectoryPreview(
                      c,
                      action.localGrantId,
                      r.local.id,
                    );
                  } catch {
                    // Keep a native preview that still requires explicit cleanup.
                  }
                }
                this.disposeRecord(r);
                this.records.delete(r.view.id);
                throw error;
              } finally {
                this.preparing--;
              }
            }
            r = this.owned(c, action.previewId, true);
            this.assert(r, c, action);
            return this.scope(
              r,
              c,
              action,
              guard,
              stop,
              () =>
                action.type === "file.directory.confirm"
                  ? this.confirm(r, action)
                  : this.entry(r, action),
              operation,
            );
          },
          dispose: () => {
            disposed = true;
            stop.abort();
          },
        };
      },
    };
  }
  retain(c: FileTaskContext, id: string) {
    const r = this.owned(c, id, true),
      token = Object.freeze({});
    if (r.view.assigned) throw Error("DIRECTORY_PREVIEW_USED");
    r.view.assigned = true;
    r.holders.add(token);
    return () => {
      r.holders.delete(token);
    };
  }
  list(c: FileTaskContext) {
    return [...this.records.values()]
      .filter((r) => r.previewFinished && identity(c, r.context))
      .map((r) => ({ ...structuredClone(r.view), inUse: r.holders.size > 0 }));
  }
  summary(c: FileTaskContext, id: string) {
    const r = this.owned(c, id);
    return { ...structuredClone(r.view), inUse: r.holders.size > 0 };
  }
  page(c: FileTaskContext, id: string, offset = 0, limit = 100) {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error("INVALID_REQUEST");
    const r = this.owned(c, id),
      rows = [...r.entries.values()];
    return {
      ...structuredClone(r.view),
      inUse: r.holders.size > 0,
      offset,
      items: rows
        .slice(offset, offset + limit)
        .map(
          ({
            sourceId: _sourceId,
            lastModified: _lastModified,
            resultData: _resultData,
            binary: _binary,
            ...e
          }) => structuredClone(e),
        ),
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      contentTrust: "untrusted-directory-transfer-entries",
    };
  }
  confirmation(
    c: FileTaskContext,
    id: string,
    choices: Extract<
      DirectoryAction,
      { type: "file.directory.confirm" }
    >["choices"],
  ): Extract<DirectoryAction, { type: "file.directory.confirm" }> {
    const r = this.owned(c, id, true);
    return {
      type: "file.directory.confirm",
      direction: r.action.direction,
      path: r.action.path,
      localGrantId: r.action.localGrantId,
      localVersion: r.action.localVersion,
      overwrite: r.action.overwrite,
      timeoutMs: r.action.timeoutMs,
      previewId: id,
      revision: r.view.revision,
      choices: structuredClone(choices),
    };
  }
  actions(
    c: FileTaskContext,
    id: string,
  ): Array<Extract<DirectoryAction, { type: "file.directory.entry" }>> {
    const r = this.owned(c, id, true);
    if (r.view.state !== "confirmed") throw Error("DIRECTORY_NOT_CONFIRMED");
    return [...r.entries.values()]
      .filter((e) => e.action !== "skip" && e.kind !== "excluded")
      .sort(
        (a, b) =>
          a.relativePath.split("/").length - b.relativePath.split("/").length,
      )
      .map((e) => ({
        type: "file.directory.entry",
        direction: r.action.direction,
        path: e.path,
        canonicalPath: e.path,
        rootPath: r.action.path,
        canonicalRoot: r.rootCanonical,
        localGrantId: r.action.localGrantId,
        localVersion: r.action.localVersion,
        overwrite: r.action.overwrite,
        timeoutMs: r.action.timeoutMs,
        previewId: id,
        revision: r.view.revision,
        entryId: e.id,
      }));
  }
  async release(c: FileTaskContext, id: string) {
    const r = this.owned(c, id);
    if (r.holders.size) throw Error("DIRECTORY_IN_PROGRESS");
    if (
      r.busy ||
      [...r.entries.values()].some(
        (e) =>
          e.resultData?.status === "unknown" ||
          e.resultData?.result?.transfer?.cleanupRequired,
      )
    )
      throw Error("FILE_TRANSFER_CLEANUP_PENDING");
    if (r.local) {
      await this.grants.cancelDirectoryPreview(
        c,
        r.action.localGrantId,
        r.local.id,
      );
      this.grants.forgetDirectoryPreview(c, r.action.localGrantId, r.local.id);
    }
    this.disposeRecord(r);
    this.records.delete(id);
    return { id, released: true };
  }
  private disposeRecord(r: Record) {
    if (r.scope) r.scope.active = false;
    r.scope?.close();
    r.stop?.abort();
    for (const e of r.entries.values()) e.binary?.dispose();
    r.uploadTrees.dispose();
    r.downloadTrees.dispose();
    r.uploads.dispose();
    r.downloads.dispose();
  }
  dispose() {
    this.closed = true;
    for (const r of this.records.values()) this.disposeRecord(r);
    this.records.clear();
  }
}
