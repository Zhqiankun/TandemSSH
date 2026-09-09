import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import type {
  FileCharset,
  FileDocumentContent,
  FileDocumentInfo,
  FileTextFormat,
  SaveFileDocument,
  SavedFileDocument,
} from "../../types/file-document.js";
import type {
  FileDocumentTarget,
  RemoteFileSnapshot,
  RemoteFileStat,
} from "./ports.js";
import { decodeDocument, encodeDocument } from "./encoding.js";
import { FilePathLocks } from "./path-locks.js";
export const MAX_EDITOR_BYTES = 8 * 1024 * 1024,
  MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
export interface DocumentActor {
  signal?: AbortSignal;
  access?: FileDocumentTarget;
  userId: string;
  source: "human" | "agent" | "mcp" | "workflow";
  taskId?: string;
}
interface Baseline {
  owner: string;
  userId: string;
  connection: string;
  targetKey: string;
  document: FileDocumentInfo;
  hash: string;
  textHash?: string;
  acceptedHostKey?: string;
  stat: RemoteFileStat;
  createdAt: number;
}
import { DocumentError } from "./errors.js";
export { DocumentError } from "./errors.js";
export interface DocumentPorts {
  target(actor: DocumentActor, sessionId: string): Promise<FileDocumentTarget>;
  audit(actor: DocumentActor, type: string, data: unknown): Promise<void>;
  beginWrite(
    actor: DocumentActor,
    target: FileDocumentTarget,
    takeover: boolean,
  ): () => void;
}
const ownerKey = (actor: DocumentActor) => {
  if (actor.source !== "human" && !actor.taskId)
    throw new DocumentError("FILE_TASK_REQUIRED");
  return JSON.stringify([actor.userId, actor.source, actor.taskId ?? null]);
};
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function pathValue(value: string) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\0") ||
    value.length > 4096
  )
    throw new DocumentError("FILE_PATH_INVALID");
  return value;
}
const attributes = (stat: RemoteFileStat) => [
  stat.size,
  stat.mtime,
  stat.mode,
  stat.uid,
  stat.gid,
];
export class DocumentService {
  private readonly baselines = new Map<string, Baseline>();
  private readonly retained = new Map<
    string,
    {
      owner: string;
      userId: string;
      release: () => void;
      usedAt: number;
      latestVersion: string;
    }
  >();
  private readonly requests = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<SavedFileDocument>;
      createdAt: number;
    }
  >();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly ports: DocumentPorts,
    private readonly locks = new FilePathLocks(),
  ) {
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref?.();
  }
  dispose() {
    clearInterval(this.timer);
    for (const value of this.retained.values()) value.release();
    this.retained.clear();
    this.baselines.clear();
  }
  close(actor: DocumentActor, documentId: string) {
    const key = ownerKey(actor),
      hold = this.retained.get(documentId);
    if (hold?.owner === key) {
      hold.release();
      this.retained.delete(documentId);
    }
    for (const [version, base] of this.baselines)
      if (base.owner === key && base.document.documentId === documentId)
        this.baselines.delete(version);
  }
  private prune() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, hold] of this.retained)
      if (hold.usedAt < cutoff) {
        hold.release();
        this.retained.delete(id);
      }
    for (const [id, base] of this.baselines)
      if (base.createdAt < cutoff) this.baselines.delete(id);
    while (this.baselines.size >= 1024) {
      const row = [...this.baselines].find(
        ([version, base]) =>
          this.retained.get(base.document.documentId)?.latestVersion !==
          version,
      );
      if (!row) break;
      this.baselines.delete(row[0]);
    }
    for (const [id, value] of this.requests)
      if (value.createdAt < cutoff) this.requests.delete(id);
  }
  private document(
    actor: DocumentActor,
    target: FileDocumentTarget,
    path: string,
    canonical: string,
    snapshot: RemoteFileSnapshot,
    charset?: FileCharset,
    retain = false,
    existingDocumentId?: string,
  ): FileDocumentContent {
    this.prune();
    if (
      this.baselines.size >= 1024 ||
      (retain &&
        !existingDocumentId &&
        (this.retained.size >= 256 ||
          [...this.retained.values()].filter(
            (value) => value.userId === actor.userId,
          ).length >= 128))
    )
      throw new DocumentError("FILE_DOCUMENT_LIMIT");
    const decoded = decodeDocument(snapshot.bytes, charset),
      editable =
        decoded.text !== undefined && snapshot.bytes.length <= MAX_EDITOR_BYTES;
    const document: FileDocumentInfo = {
      documentId: existingDocumentId ?? randomUUID(),
      version: randomUUID(),
      path,
      canonicalPath: canonical,
      hostIdentity: target.hostScope?.identity,
      size: snapshot.bytes.length,
      mtime: snapshot.stat.mtime,
      mode: snapshot.stat.mode & 0o7777,
      viaSymlink: path !== canonical,
      editable,
      format: decoded.format,
      readOnlyReason:
        decoded.text === undefined
          ? decoded.reason
          : !editable
            ? "too-large"
            : undefined,
    };
    if (retain && !this.retained.has(document.documentId) && target.retain)
      this.retained.set(document.documentId, {
        owner: ownerKey(actor),
        userId: actor.userId,
        release: target.retain(),
        usedAt: Date.now(),
        latestVersion: document.version,
      });
    const hold = this.retained.get(document.documentId);
    if (hold) {
      hold.usedAt = Date.now();
      hold.latestVersion = document.version;
    }
    this.baselines.set(document.version, {
      owner: ownerKey(actor),
      userId: actor.userId,
      connection: target.connection,
      targetKey: target.key,
      document: structuredClone(document),
      hash: hash(snapshot.bytes),
      textHash:
        decoded.text === undefined
          ? undefined
          : hash(decoded.text.replace(/\r\n|\r/g, "\n")),
      acceptedHostKey: target.acceptedHostKey,
      stat: { ...snapshot.stat },
      createdAt: Date.now(),
    });
    return {
      document,
      content:
        decoded.text === undefined
          ? snapshot.bytes.toString("base64")
          : decoded.text.replace(/\r\n|\r/g, "\n"),
      path,
      encoding: decoded.text === undefined ? "base64" : "utf8",
    };
  }
  async draftContext(
    actor: DocumentActor,
    sessionId: string,
    version: string,
    original?: string,
  ) {
    if (actor.source !== "human")
      throw new DocumentError("TRUSTED_UI_REQUIRED");
    const base = this.baselines.get(version);
    if (
      !base ||
      base.owner !== ownerKey(actor) ||
      !this.retained.has(base.document.documentId)
    )
      throw new DocumentError("FILE_VERSION_EXPIRED");
    if (
      !base.document.editable ||
      !base.document.format ||
      !base.document.hostIdentity ||
      !base.acceptedHostKey
    )
      throw new DocumentError("FILE_DRAFT_IDENTITY_UNAVAILABLE");
    if (original !== undefined && hash(original) !== base.textHash)
      throw new DocumentError("FILE_DRAFT_BASE_CHANGED");
    const target = await this.ports.target(actor, sessionId);
    target.check("read", base.document.path, base.document.canonicalPath);
    if (
      base.connection !== target.connection ||
      base.targetKey !== target.key ||
      base.acceptedHostKey !== target.acceptedHostKey
    )
      throw new DocumentError("FILE_CONNECTION_CHANGED");
    return {
      binding: {
        userId: actor.userId,
        targetKey: base.targetKey,
        acceptedHostKey: base.acceptedHostKey,
        hostIdentity: base.document.hostIdentity,
        path: base.document.path,
        canonicalPath: base.document.canonicalPath,
      },
      format: { ...base.document.format },
    };
  }
  private async snapshot(
    target: FileDocumentTarget,
    requested: string,
    action: "read" | "write",
  ) {
    const canonical = pathValue(await target.io.resolve(requested));
    target.check(action, requested, canonical);
    const snapshot = await target.io.snapshot(
      canonical,
      MAX_PREVIEW_BYTES,
      () => target.check(action, requested, canonical),
    );
    target.check(action, requested, canonical);
    if ((await target.io.resolve(requested)) !== canonical)
      throw new DocumentError("FILE_TARGET_CHANGED");
    return { canonical, snapshot };
  }
  async read(
    actor: DocumentActor,
    sessionId: string,
    path: string,
    charset?: FileCharset,
    retain = false,
  ): Promise<FileDocumentContent> {
    pathValue(path);
    const target = await this.ports.target(actor, sessionId),
      { canonical, snapshot } = await this.snapshot(target, path, "read");
    await this.ports.audit(actor, "file.read", {
      sessionId,
      path,
      canonicalPath: canonical,
      bytes: snapshot.bytes.length,
    });
    target.check("read", path, canonical);
    return this.document(
      actor,
      target,
      path,
      canonical,
      snapshot,
      charset,
      retain,
    );
  }
  save(
    actor: DocumentActor,
    input: SaveFileDocument,
  ): Promise<SavedFileDocument> {
    if (
      !input.requestId ||
      input.requestId.length > 128 ||
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content, "utf8") > MAX_PREVIEW_BYTES
    )
      return Promise.reject(new DocumentError("FILE_SAVE_INVALID"));
    const frozen = structuredClone(input),
      key = JSON.stringify([
        actor.userId,
        actor.source,
        actor.taskId ?? null,
        input.requestId,
      ]),
      fingerprint = hash(JSON.stringify(frozen)),
      old = this.requests.get(key);
    if (old)
      return old.fingerprint === fingerprint
        ? old.promise.then((result) => structuredClone(result))
        : Promise.reject(new DocumentError("REQUEST_CONFLICT"));
    this.prune();
    if (this.requests.size >= 512)
      return Promise.reject(new DocumentError("FILE_REQUEST_LIMIT"));
    const promise = this.commit(actor, frozen);
    this.requests.set(key, { fingerprint, promise, createdAt: Date.now() });
    return promise.then((result) => structuredClone(result));
  }
  private async commit(
    actor: DocumentActor,
    input: SaveFileDocument,
  ): Promise<SavedFileDocument> {
    const requested = pathValue(input.path),
      base = this.baselines.get(input.version);
    if (!base || base.owner !== ownerKey(actor))
      throw new DocumentError("FILE_BASELINE_EXPIRED");
    if (base.document.path !== requested)
      throw new DocumentError("FILE_BASELINE_MISMATCH");
    if (!base.document.editable || !base.document.format)
      throw new DocumentError("FILE_READ_ONLY");
    const target = await this.ports.target(actor, input.sessionId);
    if (base.connection !== target.connection || base.targetKey !== target.key)
      throw new DocumentError("FILE_CONNECTION_CHANGED");
    const format: FileTextFormat = input.format ?? base.document.format;
    const encoded = encodeDocument(input.content, format);
    if (encoded.bytes.length > MAX_EDITOR_BYTES)
      throw new DocumentError("FILE_TOO_LARGE");
    let writePath = requested,
      canonical = base.document.canonicalPath,
      create = false;
    if (input.saveAs) {
      writePath = pathValue(input.saveAs);
      const parent = await target.io.resolve(posix.dirname(writePath));
      const leaf = posix.basename(writePath);
      if (!leaf || leaf === "." || leaf === "..")
        throw new DocumentError("FILE_PATH_INVALID");
      canonical = posix.join(parent, leaf);
      create = true;
    }
    target.check("write", writePath, canonical);
    const release = this.locks.acquire(target.key + "\0" + canonical);
    let endWrite: (() => void) | undefined;
    let temporaryPath: string | undefined;
    let commitSent = false;
    const guard = () => {
      if (!this.baselines.has(input.version))
        throw new DocumentError("FILE_BASELINE_EXPIRED");
      target.check("write", writePath, canonical);
    };
    try {
      endWrite = this.ports.beginWrite(actor, target, !!input.takeover);
      guard();
      let metadata: RemoteFileStat | undefined = create ? undefined : base.stat;
      if (create) {
        try {
          await target.io.stat(canonical);
          throw new DocumentError("FILE_ALREADY_EXISTS");
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "FILE_NOT_FOUND")
            throw error;
        }
      } else {
        const current = await this.snapshot(target, requested, "write");
        if (current.canonical !== base.document.canonicalPath)
          throw new DocumentError("FILE_TARGET_CHANGED");
        if (
          hash(current.snapshot.bytes) !== base.hash ||
          JSON.stringify(attributes(current.snapshot.stat)) !==
            JSON.stringify(attributes(base.stat))
        )
          throw new DocumentError("FILE_CONFLICT", {
            latest: this.document(
              actor,
              target,
              requested,
              current.canonical,
              current.snapshot,
              base.document.format.charset,
              false,
              base.document.documentId,
            ),
          });
        metadata = current.snapshot.stat;
      }
      temporaryPath = posix.join(
        posix.dirname(canonical),
        ".tandem-save-" + randomUUID(),
      );
      await this.ports.audit(actor, "file.write.intent", {
        sessionId: input.sessionId,
        path: writePath,
        canonicalPath: canonical,
        temporaryPath,
        expectedHash: base.hash,
        newHash: hash(encoded.bytes),
        bytes: encoded.bytes.length,
        format,
        create,
      });
      guard();
      await target.io.createExclusive(
        temporaryPath,
        encoded.bytes,
        metadata,
        guard,
      );
      const staged = await target.io.snapshot(
        temporaryPath,
        MAX_EDITOR_BYTES,
        guard,
      );
      if (hash(staged.bytes) !== hash(encoded.bytes))
        throw new DocumentError("FILE_STAGE_VERIFICATION_FAILED");
      guard();
      if (create) {
        if (
          (await target.io.resolve(posix.dirname(writePath))) !==
          posix.dirname(canonical)
        )
          throw new DocumentError("FILE_TARGET_CHANGED");
      } else {
        const current = await this.snapshot(target, requested, "write");
        if (current.canonical !== canonical)
          throw new DocumentError("FILE_TARGET_CHANGED");
        if (
          hash(current.snapshot.bytes) !== base.hash ||
          JSON.stringify(attributes(current.snapshot.stat)) !==
            JSON.stringify(attributes(base.stat))
        )
          throw new DocumentError("FILE_CONFLICT", {
            latest: this.document(
              actor,
              target,
              requested,
              canonical,
              current.snapshot,
              base.document.format.charset,
              false,
              base.document.documentId,
            ),
          });
      }
      await this.ports.audit(actor, "file.write.commit", {
        path: writePath,
        canonicalPath: canonical,
        temporaryPath,
        bytes: encoded.bytes.length,
      });
      guard();
      commitSent = true;
      const result = await target.io.replace(
        temporaryPath,
        canonical,
        !create,
        guard,
      );
      temporaryPath = undefined;
      const written = await this.snapshot(target, writePath, "read");
      if (
        written.canonical !== canonical ||
        hash(written.snapshot.bytes) !== hash(encoded.bytes)
      )
        throw new DocumentError("FILE_POST_SAVE_CHANGED", {
          latest: this.document(
            actor,
            target,
            writePath,
            written.canonical,
            written.snapshot,
            format.charset,
            false,
            base.document.documentId,
          ),
          commitMayHaveOccurred: true,
        });
      const document = this.document(
        actor,
        target,
        writePath,
        canonical,
        written.snapshot,
        format.charset,
        false,
        base.document.documentId,
      ).document;
      await this.ports.audit(actor, "file.write.completed", {
        path: writePath,
        canonicalPath: canonical,
        version: document.version,
        bytes: encoded.bytes.length,
        atomic: result.atomic,
      });
      return {
        document,
        bytes: encoded.bytes.length,
        atomic: result.atomic,
        warnings: ["EXTERNAL_WRITER_RACE_POSSIBLE"],
      };
    } catch (error) {
      const failure =
        error instanceof DocumentError
          ? error
          : new DocumentError(
              error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "FILE_SAVE_FAILED",
            );
      failure.details = {
        ...failure.details,
        temporaryPath: failure.details.temporaryPath ?? temporaryPath,
        commitMayHaveOccurred:
          failure.details.commitMayHaveOccurred ?? commitSent,
      };
      try {
        await this.ports.audit(actor, "file.write.failed", {
          path: writePath,
          error: failure.message,
          ...failure.details,
          latest: undefined,
        });
      } catch {
        /* The request remains failed even if failure logging is unavailable. */
      }
      throw failure;
    } finally {
      endWrite?.();
      release();
    }
  }
}
