import { FileInspectionStore } from "./inspection.js";
import {
  createHash,
  createHmac,
  createSecretKey,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { posix } from "node:path";
import type { FileExecutorPort } from "../collaboration/operations/gateway.js";
import type { FileAction } from "../../types/file-operations.js";
import type {
  FileDocumentContent,
  FileTextFormat,
} from "../../types/file-document.js";
import type {
  FileBodyView,
  FileEditRequest,
  FileChangeReview,
} from "../../types/file-automation.js";
import type { ControlSnapshot } from "../../types/collaboration.js";
import {
  DocumentService,
  DocumentError,
  type DocumentActor,
} from "./document-service.js";
import { encodeDocument } from "./encoding.js";
import { scrubFileContent } from "./content-redaction.js";
export interface FileTaskContext {
  userId: string;
  taskId: string;
  sessionId: string;
  control: Pick<ControlSnapshot, "generation" | "controlEpoch">;
}
interface ReadRecord {
  context: FileTaskContext;
  actor: DocumentActor;
  file: FileDocumentContent;
  safeContent: string;
  redacted: boolean;
  expires: number;
  covered: Array<[number, number]>;
  size: number;
}
interface Proposal {
  id: string;
  context: FileTaskContext;
  source: ReadRecord;
  content: string;
  format: FileTextFormat;
  action: FileAction & { type: "file.write" };
  expires: number;
  size: number;
}
export interface AutomatedDocumentPorts {
  open(
    actor: DocumentActor,
    sessionId: string,
    guard: (canonical?: string) => void,
    signal: AbortSignal,
  ): Promise<{
    access: NonNullable<DocumentActor["access"]>;
    close: () => void;
  }>;
}
const leaseKey = (c: FileTaskContext) =>
  JSON.stringify([
    c.userId,
    c.taskId,
    c.sessionId,
    c.control.generation,
    c.control.controlEpoch,
  ]);
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const lifetime = 15 * 60 * 1000,
  bodyLimit = 64 * 1024 * 1024,
  textLimit = 8 * 1024 * 1024;
export class AutomatedDocuments {
  private readonly inspection = new FileInspectionStore();
  private readonly integrityKey = createSecretKey(randomBytes(32));
  private contentTag(bytes: Buffer): string {
    return createHmac("sha256", this.integrityKey).update(bytes).digest("hex");
  }
  private readonly reads = new Map<string, ReadRecord>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly receipts = new Map<
    string,
    {
      userId: string;
      taskId: string;
      operationId: string;
      proposalId: string;
      digest: string;
      revision: number;
      control: string;
      expires: number;
    }
  >();
  private readonly requests = new Map<
    string,
    { fingerprint: string; proposalId: string; expires: number }
  >();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly documents: DocumentService,
    private readonly ports: AutomatedDocumentPorts,
  ) {
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref?.();
  }
  dispose() {
    clearInterval(this.timer);
    for (const r of this.reads.values())
      this.documents.close(r.actor, r.file.document.documentId);
    this.inspection.clear();
    this.reads.clear();
    this.proposals.clear();
    this.receipts.clear();
    this.requests.clear();
  }
  private prune() {
    this.inspection.prune();
    const now = Date.now();
    for (const [id, r] of this.reads)
      if (r.expires <= now) {
        this.documents.close(r.actor, r.file.document.documentId);
        this.reads.delete(id);
      }
    for (const [id, p] of this.proposals)
      if (p.expires <= now) this.proposals.delete(id);
    for (const [id, r] of this.receipts)
      if (r.expires <= now) this.receipts.delete(id);
    for (const [id, r] of this.requests)
      if (r.expires <= now) this.requests.delete(id);
  }
  private reserve(userId: string, bytes: number) {
    this.prune();
    const rows = [...this.reads.values(), ...this.proposals.values()];
    if (
      this.reads.size + this.proposals.size >= 128 ||
      rows.reduce((n, r) => n + r.size, 0) + bytes > bodyLimit ||
      rows
        .filter((r) => r.context.userId === userId)
        .reduce((n, r) => n + r.size, 0) +
        bytes >
        32 * 1024 * 1024
    )
      throw Error("FILE_CONTEXT_LIMIT");
  }
  private ownedRead(context: FileTaskContext, version: string) {
    this.prune();
    const r = this.reads.get(version);
    if (!r || leaseKey(r.context) !== leaseKey(context))
      throw Error("FILE_CONTEXT_EXPIRED");
    return r;
  }
  content(
    context: FileTaskContext,
    version: string,
    offset = 0,
    maximum = 12000,
  ): FileBodyView {
    const r = this.ownedRead(context, version);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      maximum > 64000 ||
      offset > r.safeContent.length
    )
      throw Error("INVALID_FILE_RANGE");
    const scrubbed = r.safeContent,
      redacted = r.redacted;
    let end = Math.min(offset + maximum, scrubbed.length);
    const low = (index: number) => {
        const c = scrubbed.charCodeAt(index);
        return c >= 0xdc00 && c <= 0xdfff;
      },
      high = (index: number) => {
        const c = scrubbed.charCodeAt(index);
        return c >= 0xd800 && c <= 0xdbff;
      };
    if (offset > 0 && low(offset) && high(offset - 1))
      throw Error("INVALID_FILE_RANGE");
    if (end < scrubbed.length && high(end - 1) && low(end))
      end = end - 1 === offset ? end + 1 : end - 1;
    const ranges = [...r.covered, [offset, end] as [number, number]].sort(
      (a, b) => a[0] - b[0],
    );
    const merged: Array<[number, number]> = [];
    for (const pair of ranges) {
      const last = merged.at(-1);
      if (last && pair[0] <= last[1]) last[1] = Math.max(last[1], pair[1]);
      else merged.push([...pair]);
    }
    if (merged.length > 256) throw Error("FILE_RANGE_LIMIT");
    r.covered = merged;
    const all =
      r.covered.length === 1 &&
      r.covered[0][0] === 0 &&
      r.covered[0][1] >= scrubbed.length;
    return {
      document: structuredClone(r.file.document),
      content: scrubbed.slice(offset, end),
      offset,
      nextOffset: end < scrubbed.length ? end : undefined,
      complete: end === scrubbed.length,
      redacted,
      canReplace: !redacted && all && r.file.document.editable,
      contentTrust: "untrusted-file-content",
    };
  }
  propose(
    context: FileTaskContext,
    input: FileEditRequest,
    requestId: string,
  ): FileAction {
    if (!requestId || requestId.length > 128) throw Error("INVALID_REQUEST");
    const requestKey = JSON.stringify([
        context.userId,
        context.taskId,
        requestId,
      ]),
      fingerprint = hash(JSON.stringify(input));
    this.prune();
    const prior = this.requests.get(requestKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error("REQUEST_CONFLICT");
      const proposal = this.proposals.get(prior.proposalId);
      if (!proposal || leaseKey(proposal.context) !== leaseKey(context))
        throw Error("FILE_CONTEXT_EXPIRED");
      return structuredClone(proposal.action);
    }
    const source = this.ownedRead(context, input.version);
    if (!source.file.document.editable || !source.file.document.format)
      throw Error("FILE_READ_ONLY");
    if ((input.content === undefined) === (input.edits === undefined))
      throw Error("INVALID_FILE_EDIT");
    let content: string;
    if (input.content !== undefined) {
      const scrubbed = source.safeContent;
      const all =
        source.covered.length === 1 &&
        source.covered[0][0] === 0 &&
        source.covered[0][1] >= scrubbed.length;
      if (source.redacted || !all) throw Error("FILE_FULL_READ_REQUIRED");
      content = input.content;
    } else {
      if (!input.edits?.length || input.edits.length > 32)
        throw Error("INVALID_FILE_EDIT");
      content = source.file.content;
      for (const edit of input.edits) {
        if (
          !edit.before ||
          edit.before.length > 64000 ||
          edit.after.length > 128000 ||
          scrubFileContent(edit.before) !== edit.before ||
          /\[redacted(?:[^\]]*)\]/i.test(edit.before + edit.after)
        )
          throw Error("FILE_EDIT_REDACTED");
        if (!source.safeContent.includes(edit.before))
          throw Error("FILE_EDIT_NOT_UNIQUE");
        const first = content.indexOf(edit.before);
        if (first < 0 || content.indexOf(edit.before, first + 1) >= 0)
          throw Error("FILE_EDIT_NOT_UNIQUE");
        content =
          content.slice(0, first) +
          edit.after +
          content.slice(first + edit.before.length);
      }
    }
    if (
      Buffer.byteLength(content, "utf8") > 32 * 1024 * 1024 ||
      (/\[redacted(?:[^\]]*)\]/i.test(content) && input.content !== undefined)
    )
      throw Error("FILE_EDIT_INVALID");
    const format = input.format ?? source.file.document.format,
      encoded = encodeDocument(content, format);
    if (encoded.bytes.length > textLimit) throw Error("FILE_TOO_LARGE");
    const path = input.saveAs ?? source.file.document.path;
    if (
      !path.startsWith("/") ||
      /[\x00-\x1f\x7f]/.test(path) ||
      path.length > 4096
    )
      throw Error("FILE_PATH_INVALID");
    // Save-as stays in the verified canonical parent. Other destinations require a fresh read/transfer plan.
    if (
      input.saveAs &&
      posix.dirname(posix.normalize(path)) !==
        posix.dirname(source.file.document.canonicalPath)
    )
      throw Error("FILE_SAVE_AS_PARENT_REQUIRED");
    const canonicalPath = input.saveAs
        ? posix.normalize(path)
        : source.file.document.canonicalPath,
      id = randomUUID(),
      size = Math.max(Buffer.byteLength(content, "utf8"), content.length * 2);
    this.reserve(context.userId, size);
    const action: FileAction & { type: "file.write" } = {
      type: "file.write",
      path,
      canonicalPath,
      proposalId: id,
      version: input.version,
      contentHash: this.contentTag(encoded.bytes),
      bytes: encoded.bytes.length,
      format: structuredClone(format),
    };
    this.proposals.set(id, {
      id,
      context: structuredClone(context),
      source,
      content,
      format: structuredClone(format),
      action,
      expires: Math.min(Date.now() + lifetime, source.expires),
      size,
    });
    this.requests.set(requestKey, {
      fingerprint,
      proposalId: id,
      expires: source.expires,
    });
    return structuredClone(action);
  }
  review(
    userId: string,
    taskId: string,
    operationId: string,
    action: FileAction,
    digest: string,
    revision: number,
    control: FileTaskContext["control"],
  ): FileChangeReview {
    this.prune();
    if (action.type !== "file.write") throw Error("FILE_REVIEW_UNAVAILABLE");
    const p = this.proposals.get(action.proposalId);
    if (
      !p ||
      p.context.userId !== userId ||
      p.context.taskId !== taskId ||
      JSON.stringify(p.action) !== JSON.stringify(action)
    )
      throw Error("FILE_CONTEXT_EXPIRED");
    if (this.receipts.size >= 256) throw Error("FILE_CONTEXT_LIMIT");
    const reviewId = randomUUID();
    this.receipts.set(reviewId, {
      userId,
      taskId,
      operationId,
      proposalId: p.id,
      digest,
      revision,
      control: JSON.stringify([control.generation, control.controlEpoch]),
      expires: Date.now() + 5 * 60000,
    });
    return {
      reviewId,
      proposalId: p.id,
      operationId,
      digest,
      path: p.action.path,
      canonicalPath: p.action.canonicalPath,
      format: structuredClone(p.format),
      before: p.source.file.content,
      after: p.content,
      bytes: p.action.bytes,
    };
  }
  validReview(
    userId: string,
    taskId: string,
    operationId: string,
    proposalId: string,
    digest: string,
    revision: number,
    control: FileTaskContext["control"],
    receipt?: string,
  ): boolean {
    this.prune();
    const r = receipt ? this.receipts.get(receipt) : undefined;
    return (
      !!r &&
      this.proposals.has(proposalId) &&
      r.userId === userId &&
      r.taskId === taskId &&
      r.operationId === operationId &&
      r.proposalId === proposalId &&
      r.digest === digest &&
      r.revision === revision &&
      r.control === JSON.stringify([control.generation, control.controlEpoch])
    );
  }
  executor(userId: string, sessionId: string): FileExecutorPort {
    return {
      prepare: async (action, operationId, operation) => {
        if (action.type === "file.upload" || action.type === "file.download")
          throw Error("FILE_TRANSFER_EXECUTOR_UNAVAILABLE");
        const context: FileTaskContext = {
          userId,
          sessionId,
          taskId: operation.taskId,
          control: {
            generation: operation.lease.generation,
            controlEpoch: operation.lease.controlEpoch,
          },
        };
        const controller = new AbortController();
        let release: (() => void) | undefined;
        let disposed = false;
        const actor: DocumentActor = {
          userId,
          taskId: operation.taskId,
          source:
            operation.origin === "mcp"
              ? "mcp"
              : operation.origin === "workflow"
                ? "workflow"
                : "agent",
          signal: controller.signal,
        };
        return {
          execute: async (guard) => {
            let loaded: FileDocumentContent | undefined;
            try {
              if (disposed) throw Error("FILE_REQUEST_CANCELLED");
              guard();
              const opened = await this.ports.open(
                actor,
                sessionId,
                guard,
                controller.signal,
              );
              release = opened.close;
              actor.access = opened.access;
              if (disposed) {
                release();
                throw Error("FILE_REQUEST_CANCELLED");
              }
              if (action.type === "file.list" || action.type === "file.stat") {
                return {
                  status: "succeeded",
                  result: await this.inspection.inspect(
                    action,
                    context,
                    opened.access,
                    guard,
                  ),
                };
              }
              if (action.type === "file.read") {
                loaded = await this.documents.read(
                  actor,
                  sessionId,
                  action.path,
                  action.charset,
                  true,
                );
                guard(loaded.document.canonicalPath);
                if (
                  loaded.encoding !== "utf8" ||
                  loaded.document.size > textLimit
                ) {
                  this.documents.close(actor, loaded.document.documentId);
                  return {
                    status: "succeeded",
                    result: {
                      document: loaded.document,
                      contentAvailable: false,
                    },
                  };
                }
                const safeContent = scrubFileContent(loaded.content),
                  redacted = safeContent !== loaded.content;
                const size =
                  Math.max(
                    Buffer.byteLength(loaded.content, "utf8"),
                    loaded.content.length * 2,
                  ) + (redacted ? safeContent.length * 2 : 0);
                this.reserve(userId, size);
                this.reads.set(loaded.document.version, {
                  context,
                  actor: { ...actor, signal: undefined, access: undefined },
                  file: loaded,
                  safeContent,
                  redacted,
                  expires: Date.now() + lifetime,
                  covered: [],
                  size,
                });
                return {
                  status: "succeeded",
                  result: { document: loaded.document, contentAvailable: true },
                };
              }
              this.prune();
              const p = this.proposals.get(action.proposalId);
              if (
                !p ||
                leaseKey(p.context) !== leaseKey(context) ||
                JSON.stringify(p.action) !== JSON.stringify(action)
              )
                throw Error("FILE_CONTEXT_EXPIRED");
              const encoded = encodeDocument(p.content, p.format);
              if (
                this.contentTag(encoded.bytes) !== action.contentHash ||
                encoded.bytes.length !== action.bytes
              )
                throw Error("FILE_PROPOSAL_CHANGED");
              const saved = await this.documents.save(actor, {
                sessionId,
                path: p.source.file.document.path,
                version: action.version,
                requestId: operationId,
                content: p.content,
                format: p.format,
                saveAs:
                  action.path !== p.source.file.document.path
                    ? action.path
                    : undefined,
              });
              return {
                status: "succeeded",
                result: {
                  document: saved.document,
                  bytes: saved.bytes,
                  contentAvailable: false,
                },
              };
            } catch (error) {
              if (loaded && !this.reads.has(loaded.document.version))
                this.documents.close(actor, loaded.document.documentId);
              const details =
                error instanceof DocumentError ? error.details : {};
              const code =
                error instanceof Error &&
                /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
                  ? error.message
                  : "FILE_OPERATION_FAILED";
              return {
                status: details.commitMayHaveOccurred ? "unknown" : "failed",
                error: code,
                result: {
                  temporaryPath: details.temporaryPath,
                  commitMayHaveOccurred: details.commitMayHaveOccurred,
                },
              };
            } finally {
              release?.();
              release = undefined;
            }
          },
          dispose: () => {
            disposed = true;
            controller.abort();
            release?.();
            release = undefined;
          },
        };
      },
    };
  }
}
