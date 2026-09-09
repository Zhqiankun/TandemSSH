import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import {
  prepareUploadSchema,
  uploadManifestSchema,
} from "./upload-contracts.js";
export {
  prepareUploadSchema,
  uploadManifestSchema,
} from "./upload-contracts.js";
import {
  uploadCheckpointSchema,
  type UploadCheckpoint,
} from "./upload-checkpoint.js";
import {
  UPLOAD_CHUNK_BYTES,
  type UploadView,
  type UploadManifest,
  type PrepareUpload,
  type StartUpload,
} from "../../types/file-upload.js";
import type {
  FileDocumentTarget,
  RemoteTransferIO,
  RemoteFileStat,
} from "./ports.js";
import { FilePathLocks } from "./path-locks.js";
import { DocumentError } from "./errors.js";
export interface UploadActor {
  userId: string;
  signal?: AbortSignal;
}
export type UploadTarget = FileDocumentTarget & { io: RemoteTransferIO };
export interface UploadPorts {
  target(userId: string, sessionId: string): Promise<UploadTarget>;
  beginWrite(
    userId: string,
    target: FileDocumentTarget,
    takeover: boolean,
  ): () => void;
  audit(
    userId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  locks: FilePathLocks;
}
export const uploadDirectoryAttributes = (s: RemoteFileStat) =>
  JSON.stringify([s.kind, s.mode, s.uid, s.gid]);
export interface UploadConstraint {
  targetKey: string;
  acceptedHostKey?: string;
  canonicalPath: string;
  baseline?: { stat: RemoteFileStat; sha256: string };
  parents: Array<{ path: string; signature: string }>;
}
interface Baseline {
  stat: RemoteFileStat;
  sha256: string;
}
interface RecordState {
  suspending?: boolean;
  constraint?: UploadConstraint;
  requestKey: string;
  pending: number;
  acceptedHostKey?: string;
  stageCreated: boolean;
  creationAttempted: boolean;
  owner: string;
  targetKey: string;
  connection: string;
  manifest: UploadManifest;
  baseline?: Baseline;
  view: UploadView;
  release?: () => void;
  cancelRequested: boolean;
  pauseRequested: boolean;
  busy: boolean;
  tail: Promise<unknown>;
}
const terminal = (s: string) =>
  ["completed", "cancelled", "unknown", "expired"].includes(s);
const attributes = (s: RemoteFileStat) =>
  JSON.stringify([s.size, s.mtime, s.mode, s.uid, s.gid, s.kind]);
const code = (e: unknown) =>
  e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
    ? e.message
    : "UPLOAD_FAILED";
const idleTime = 30 * 60 * 1000;
export class UploadService {
  private stopped = false;
  private readonly records = new Map<string, RecordState>();
  private readonly reservations = new Map<
    symbol,
    { userId: string; bytes: number }
  >();
  private readonly requests = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<UploadView>;
      createdAt: number;
      pending: boolean;
    }
  >();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly ports: UploadPorts) {
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref?.();
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const r of this.records.values()) {
      r.cancelRequested = true;
      r.release?.();
    }
    this.records.clear();
    this.requests.clear();
    this.reservations.clear();
  }
  private prune() {
    const now = Date.now();
    for (const [id, r] of this.records) {
      if (r.busy) continue;
      if (now > r.view.expiresAt) {
        r.release?.();
        r.release = undefined;
        if (terminal(r.view.state)) {
          this.records.delete(id);
        } else {
          r.view.state = "expired";
          r.view.error = "UPLOAD_EXPIRED";
          r.view.expiresAt = now + idleTime;
        }
      }
    }
    for (const [key, request] of this.requests)
      if (!request.pending && now - request.createdAt > idleTime)
        this.requests.delete(key);
  }
  private owned(actor: UploadActor, id: string) {
    const r = this.records.get(id);
    if (!r || r.owner !== actor.userId)
      throw new DocumentError("UPLOAD_NOT_FOUND");
    return r;
  }
  get(actor: UploadActor, id: string) {
    return structuredClone(this.owned(actor, id).view);
  }
  private alive(actor: UploadActor, r?: RecordState) {
    if (this.stopped) throw new DocumentError("UPLOAD_CANCELLED");
    if (actor.signal?.aborted)
      throw new DocumentError("UPLOAD_REQUEST_CANCELLED");
    if (r?.cancelRequested) throw new DocumentError("UPLOAD_CANCELLED");
    if (r?.suspending) throw new DocumentError("UPLOAD_BUSY");
  }
  private guard(actor: UploadActor, r: RecordState, target: UploadTarget) {
    return () => {
      this.alive(actor, r);
      if (r.view.expiresAt < Date.now())
        throw new DocumentError("UPLOAD_EXPIRED");
      if (
        r.pauseRequested &&
        r.view.state === "verifying" &&
        !r.view.commitMayHaveOccurred
      )
        throw new DocumentError("UPLOAD_PAUSED");
      r.view.expiresAt = Date.now() + idleTime;
      target.check("write", r.view.path, r.view.canonicalPath);
    };
  }
  private async target(
    actor: UploadActor,
    r: RecordState,
    sessionId = r.view.sessionId,
    reconnect = false,
  ) {
    this.alive(actor, r);
    const t = await this.ports.target(actor.userId, sessionId);
    this.verifyTarget(r, t, reconnect);
    if (r.constraint) await this.constrainedParents(actor, t, r.constraint);
    return t;
  }
  private verifyTarget(r: RecordState, t: UploadTarget, reconnect: boolean) {
    if (t.key !== r.targetKey || (!reconnect && t.connection !== r.connection))
      throw new DocumentError("FILE_CONNECTION_CHANGED");
    if (r.acceptedHostKey && r.acceptedHostKey !== t.acceptedHostKey)
      throw new DocumentError("UPLOAD_HOST_IDENTITY_CHANGED");
    if (
      reconnect &&
      t.connection !== r.connection &&
      (!r.acceptedHostKey || !t.acceptedHostKey)
    )
      throw new DocumentError("UPLOAD_HOST_IDENTITY_UNVERIFIED");
  }
  private async constrainedParents(
    actor: UploadActor,
    t: UploadTarget,
    c: UploadConstraint,
  ) {
    this.alive(actor);
    if (t.key !== c.targetKey || t.acceptedHostKey !== c.acceptedHostKey)
      throw new DocumentError("UPLOAD_HOST_IDENTITY_CHANGED");
    for (const parent of c.parents) {
      t.check("write", parent.path, parent.path);
      this.alive(actor);
      const actual = await t.io.stat(parent.path);
      if (
        actual.kind !== "directory" ||
        uploadDirectoryAttributes(actual) !== parent.signature ||
        (await t.io.resolve(parent.path)) !== parent.path
      )
        throw new DocumentError("FILE_TARGET_CHANGED");
    }
  }
  touch(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (r.view.expiresAt < Date.now())
      throw new DocumentError("UPLOAD_EXPIRED");
    r.view.expiresAt = Date.now() + idleTime;
    return structuredClone(r.view);
  }
  forget(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    if (
      r.busy ||
      r.pending ||
      r.view.temporaryPath ||
      r.release ||
      !["completed", "cancelled"].includes(r.view.state)
    )
      throw new DocumentError("UPLOAD_CLEANUP_PENDING");
    this.records.delete(id);
    this.requests.delete(r.requestKey);
    return structuredClone(r.view);
  }
  private hold(
    actor: UploadActor,
    r: RecordState,
    t: UploadTarget,
    takeover: boolean,
  ) {
    if (r.release) return;
    const releases: Array<() => void> = [];
    try {
      releases.push(
        this.ports.locks.acquire(t.key + "\0" + r.view.canonicalPath),
      );
      releases.push(this.ports.beginWrite(actor.userId, t, takeover));
      releases.push(t.retain?.() ?? (() => {}));
      r.release = () => {
        releases
          .splice(0)
          .reverse()
          .forEach((fn) => fn());
      };
    } catch (error) {
      releases.reverse().forEach((fn) => fn());
      throw error;
    }
  }
  private async unchanged(actor: UploadActor, r: RecordState, t: UploadTarget) {
    const guard = this.guard(actor, r, t);
    guard();
    const resolved = r.baseline
      ? await t.io.resolve(r.view.path)
      : posix.join(
          await t.io.resolve(posix.dirname(r.view.path)),
          posix.basename(r.view.path),
        );
    if (resolved !== r.view.canonicalPath)
      throw new DocumentError("FILE_TARGET_CHANGED");
    guard();
    if (!r.baseline) {
      try {
        await t.io.stat(resolved);
      } catch (error) {
        if (code(error) === "FILE_NOT_FOUND") return;
        throw error;
      }
      throw new DocumentError("FILE_CONFLICT");
    }
    const current = await t.io.inspectFile(resolved, guard);
    if (
      current.sha256 !== r.baseline.sha256 ||
      attributes(current.stat) !== attributes(r.baseline.stat)
    )
      throw new DocumentError("FILE_CONFLICT");
  }
  prepare(
    actor: UploadActor,
    input: PrepareUpload,
    constraint?: UploadConstraint,
  ): Promise<UploadView> {
    const p = prepareUploadSchema.parse(input),
      key = JSON.stringify([actor.userId, p.requestId]),
      fingerprint = createHash("sha256")
        .update(JSON.stringify({ p, constraint }))
        .digest("hex"),
      old = this.requests.get(key);
    if (old) {
      if (old.fingerprint !== fingerprint)
        return Promise.reject(new DocumentError("REQUEST_CONFLICT"));
      return old.promise.then((v) => structuredClone(v));
    }
    this.prune();
    if (this.requests.size >= 512)
      return Promise.reject(new DocumentError("UPLOAD_LIMIT"));
    const pending = [...this.reservations.values()],
      records = [...this.records.values()],
      bytes = p.manifest.hashes.length * 64;
    if (
      records.length + pending.length >= 128 ||
      records.filter((r) => r.owner === actor.userId && !terminal(r.view.state))
        .length +
        pending.filter((r) => r.userId === actor.userId).length >=
        64 ||
      records.reduce((n, r) => n + r.manifest.hashes.length * 64, 0) +
        pending.reduce((n, r) => n + r.bytes, 0) +
        bytes >
        8 * 1024 * 1024
    )
      return Promise.reject(new DocumentError("UPLOAD_LIMIT"));
    const token = Symbol();
    this.reservations.set(token, { userId: actor.userId, bytes });
    const entry = {
      fingerprint,
      promise: undefined as unknown as Promise<UploadView>,
      createdAt: Date.now(),
      pending: true,
    };
    const promise = this.preview(actor, p, constraint).finally(() => {
      this.reservations.delete(token);
      entry.pending = false;
    });
    entry.promise = promise;
    this.requests.set(key, entry);
    return promise.then((v) => structuredClone(v));
  }
  private async preview(
    actor: UploadActor,
    p: PrepareUpload,
    constraint?: UploadConstraint,
  ) {
    this.alive(actor);
    if (
      [...this.records.values()].filter(
        (r) => r.owner === actor.userId && !terminal(r.view.state),
      ).length >= 64 ||
      this.records.size >= 128
    )
      throw new DocumentError("UPLOAD_LIMIT");
    const manifestBytes =
      [...this.records.values()].reduce(
        (n, r) => n + r.manifest.hashes.length * 64,
        0,
      ) +
      p.manifest.hashes.length * 64;
    if (manifestBytes > 8 * 1024 * 1024)
      throw new DocumentError("UPLOAD_LIMIT");
    const target = await this.ports.target(actor.userId, p.sessionId),
      release = target.retain?.();
    try {
      if (constraint) await this.constrainedParents(actor, target, constraint);
      const requested = posix.normalize(p.path),
        parent = await target.io.resolve(posix.dirname(requested));
      let canonical = posix.join(parent, posix.basename(requested)),
        baseline: Baseline | undefined;
      const guard = () => {
        this.alive(actor);
        target.check("write", requested, canonical);
      };
      guard();
      let existing: RemoteFileStat | undefined;
      try {
        existing = await target.io.stat(canonical);
      } catch (error) {
        if (code(error) !== "FILE_NOT_FOUND") throw error;
      }
      if (existing) {
        if (constraint && existing.kind === "symlink")
          throw new DocumentError("FILE_TARGET_CHANGED");
        if (existing.kind === "symlink") {
          canonical = await target.io.resolve(requested);
          guard();
        }
        const checked = await target.io.inspectFile(canonical, guard);
        baseline = { stat: checked.stat, sha256: checked.sha256 };
      }
      guard();
      if (constraint) {
        await this.constrainedParents(actor, target, constraint);
        if (
          canonical !== constraint.canonicalPath ||
          Boolean(baseline) !== Boolean(constraint.baseline) ||
          (baseline &&
            (baseline.sha256 !== constraint.baseline!.sha256 ||
              attributes(baseline.stat) !==
                attributes(constraint.baseline!.stat)))
        )
          throw new DocumentError("FILE_CONFLICT");
      }
      const now = Date.now(),
        view: UploadView = {
          id: randomUUID(),
          sessionId: p.sessionId,
          path: requested,
          canonicalPath: canonical,
          hostIdentity: target.hostScope?.identity,
          name: p.manifest.name,
          totalBytes: p.manifest.size,
          receivedBytes: 0,
          chunkBytes: UPLOAD_CHUNK_BYTES,
          state: "preview",
          existing: baseline
            ? {
                size: baseline.stat.size,
                mtime: baseline.stat.mtime,
                mode: baseline.stat.mode & 0o7777,
              }
            : undefined,
          createdAt: now,
          expiresAt: now + idleTime,
        };
      this.records.set(view.id, {
        acceptedHostKey: target.acceptedHostKey,
        constraint: constraint ? structuredClone(constraint) : undefined,
        requestKey: JSON.stringify([actor.userId, p.requestId]),
        pending: 0,
        stageCreated: false,
        creationAttempted: false,
        owner: actor.userId,
        targetKey: target.key,
        connection: target.connection,
        manifest: structuredClone(p.manifest),
        baseline,
        view,
        cancelRequested: false,
        pauseRequested: false,
        busy: false,
        tail: Promise.resolve(),
      });
      return view;
    } finally {
      release?.();
    }
  }
  private mutate(
    actor: UploadActor,
    id: string,
    states: string[],
    work: (r: RecordState) => Promise<void>,
  ): Promise<UploadView> {
    const r = this.owned(actor, id);
    if (r.suspending) throw new DocumentError("UPLOAD_BUSY");
    const run = async () => {
      if (!states.includes(r.view.state))
        throw new DocumentError("UPLOAD_STATE_INVALID");
      r.busy = true;
      r.view.expiresAt = Date.now() + idleTime;
      try {
        await work(r);
      } catch (error) {
        r.view.error = code(error);
        if (!r.creationAttempted) r.view.temporaryPath = undefined;
        if (
          error instanceof DocumentError &&
          error.details.commitMayHaveOccurred === false
        )
          r.view.commitMayHaveOccurred = false;
        r.view.state = r.view.commitMayHaveOccurred
          ? "unknown"
          : r.view.error === "UPLOAD_PAUSED"
            ? "paused"
            : r.view.error === "UPLOAD_CANCELLED"
              ? "cancelled"
              : r.view.state === "preview" && !r.view.temporaryPath
                ? "preview"
                : "failed";
        r.release?.();
        r.release = undefined;
        await this.ports
          .audit(actor.userId, "upload.failed", {
            id,
            error: r.view.error,
            state: r.view.state,
            path: r.view.canonicalPath,
            temporaryPath: r.view.temporaryPath,
            receivedBytes: r.view.receivedBytes,
          })
          .catch(() => {});
      } finally {
        r.busy = false;
      }
      return structuredClone(r.view);
    };
    r.pending++;
    const pending = r.tail.then(run, run).finally(() => r.pending--);
    r.tail = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  start(actor: UploadActor, id: string, input: StartUpload) {
    const r = this.owned(actor, id);
    if (r.view.state === "uploading" || r.view.state === "completed")
      return Promise.resolve(structuredClone(r.view));
    return this.mutate(actor, id, ["preview"], async (r) => {
      if (r.baseline && !input.overwrite)
        throw new DocumentError("UPLOAD_OVERWRITE_REQUIRED");
      const t = await this.target(actor, r);
      this.hold(actor, r, t, !!input.takeover);
      await this.unchanged(actor, r, t);
      const guard = this.guard(actor, r, t);
      r.view.temporaryPath = posix.join(
        posix.dirname(r.view.canonicalPath),
        ".tandem-upload-" + randomUUID(),
      );
      await this.ports.audit(actor.userId, "upload.started", {
        id,
        path: r.view.path,
        canonicalPath: r.view.canonicalPath,
        temporaryPath: r.view.temporaryPath,
        totalBytes: r.view.totalBytes,
        overwrite: !!r.baseline,
      });
      guard();
      r.creationAttempted = true;
      await t.io.createExclusive(
        r.view.temporaryPath,
        Buffer.alloc(0),
        r.baseline?.stat,
        guard,
      );
      r.stageCreated = true;
      r.view.state = "uploading";
      r.view.error = undefined;
    });
  }
  chunk(actor: UploadActor, id: string, offset: number, bytes: Buffer) {
    const r = this.owned(actor, id);
    if (
      !Buffer.isBuffer(bytes) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset % UPLOAD_CHUNK_BYTES !== 0 ||
      bytes.length !== Math.min(UPLOAD_CHUNK_BYTES, r.manifest.size - offset) ||
      bytes.length <= 0 ||
      createHash("sha256").update(bytes).digest("hex") !==
        r.manifest.hashes[offset / UPLOAD_CHUNK_BYTES]
    )
      throw new DocumentError("UPLOAD_SOURCE_CHANGED");
    return this.mutate(actor, id, ["uploading", "completed"], async (r) => {
      if (offset + bytes.length <= r.view.receivedBytes) return;
      if (r.pauseRequested) throw new DocumentError("UPLOAD_PAUSED");
      if (offset !== r.view.receivedBytes)
        throw new DocumentError("UPLOAD_OFFSET_INVALID");
      const t = await this.target(actor, r),
        guard = this.guard(actor, r, t);
      guard();
      await t.io.writeAt(r.view.temporaryPath!, offset, bytes, guard);
      guard();
      r.view.receivedBytes = offset + bytes.length;
    });
  }
  pause(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    if (r.suspending) throw new DocumentError("UPLOAD_BUSY");
    if (
      !["uploading", "verifying", "paused", "failed", "completed"].includes(
        r.view.state,
      )
    )
      throw new DocumentError("UPLOAD_STATE_INVALID");
    r.pauseRequested = true;
    return this.mutate(
      actor,
      id,
      ["uploading", "paused", "failed", "completed"],
      async (r) => {
        if (r.view.state === "completed") return;
        r.view.state = "paused";
        r.view.error = undefined;
        r.release?.();
        r.release = undefined;
        await this.ports.audit(actor.userId, "upload.paused", {
          id,
          receivedBytes: r.view.receivedBytes,
          temporaryPath: r.view.temporaryPath,
        });
      },
    );
  }
  checkpoint(actor: UploadActor, id: string): UploadCheckpoint {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (
      r.busy ||
      r.pending ||
      r.view.state !== "paused" ||
      r.release ||
      !r.stageCreated ||
      !r.creationAttempted ||
      !r.view.temporaryPath ||
      r.view.commitMayHaveOccurred
    )
      throw new DocumentError("UPLOAD_STATE_INVALID");
    if (!r.acceptedHostKey)
      throw new DocumentError("UPLOAD_HOST_IDENTITY_UNVERIFIED");
    return this.snapshot(r);
  }
  private snapshot(r: RecordState): UploadCheckpoint {
    return uploadCheckpointSchema.parse({
      schemaVersion: 1,
      id: r.view.id,
      userId: r.owner,
      targetKey: r.targetKey,
      acceptedHostKey: r.acceptedHostKey,
      path: r.view.path,
      canonicalPath: r.view.canonicalPath,
      hostIdentity: r.view.hostIdentity,
      temporaryPath: r.view.temporaryPath,
      manifest: r.manifest,
      baseline: r.baseline,
      constraint: r.constraint,
      receivedBytes: r.view.receivedBytes,
      createdAt: r.view.createdAt,
      savedAt: Date.now(),
    });
  }
  async preserve(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    r.cancelRequested = true;
    r.pauseRequested = true;
    await r.tail;
    r.release?.();
    r.release = undefined;
    const view = structuredClone(r.view);
    let checkpoint: UploadCheckpoint | undefined;
    if (
      !r.view.commitMayHaveOccurred &&
      !["unknown", "committing", "completed"].includes(r.view.state) &&
      r.stageCreated &&
      r.view.temporaryPath
    ) {
      r.view.state = "paused";
      checkpoint = this.snapshot(r);
    }
    this.records.delete(id);
    return { view, checkpoint };
  }
  reconciled(
    actor: UploadActor,
    id: string,
    result: { sha256: string; bytes: number },
  ) {
    const r = this.owned(actor, id);
    if (r.busy || r.pending) throw new DocumentError("UPLOAD_BUSY");
    if (result.bytes !== r.manifest.size)
      throw new DocumentError("UPLOAD_RESULT_UNVERIFIED");
    Object.assign(r.view, {
      state: "completed",
      receivedBytes: result.bytes,
      sha256: result.sha256,
      verification: "sha256",
      commitMayHaveOccurred: false,
      temporaryPath: undefined,
      error: undefined,
    });
    r.release?.();
    r.release = undefined;
    return structuredClone(r.view);
  }
  async reconcile(
    actor: UploadActor,
    raw: unknown,
    sessionId: string,
    takeover = false,
    discard = false,
  ) {
    const c = uploadCheckpointSchema.parse(raw);
    if (c.userId !== actor.userId) throw new DocumentError("UPLOAD_NOT_FOUND");
    this.alive(actor);
    const t = await this.ports.target(actor.userId, sessionId);
    if (t.key !== c.targetKey || t.acceptedHostKey !== c.acceptedHostKey)
      throw new DocumentError("UPLOAD_HOST_IDENTITY_CHANGED");
    if (c.constraint) await this.constrainedParents(actor, t, c.constraint);
    const guard = () => {
      this.alive(actor);
      t.check("write", c.path, c.canonicalPath);
    };
    guard();
    if (
      (await t.io.resolve(posix.dirname(c.temporaryPath))) !==
      posix.dirname(c.temporaryPath)
    )
      throw new DocumentError("FILE_TARGET_CHANGED");
    let result: { sha256: string; bytes: number } | undefined;
    if (!discard) {
      if ((await t.io.resolve(c.path)) !== c.canonicalPath)
        throw new DocumentError("FILE_TARGET_CHANGED");
      const target = await t.io.inspectFile(c.canonicalPath, guard);
      if (
        target.bytes !== c.manifest.size ||
        JSON.stringify(target.hashes) !== JSON.stringify(c.manifest.hashes)
      )
        throw new DocumentError("UPLOAD_RESULT_UNVERIFIED");
      result = { sha256: target.sha256, bytes: target.bytes };
    }
    let exists = true;
    try {
      await t.io.stat(c.temporaryPath);
    } catch (e) {
      if (code(e) === "FILE_NOT_FOUND") exists = false;
      else throw e;
    }
    if (exists) {
      if ((await t.io.resolve(c.temporaryPath)) !== c.temporaryPath)
        throw new DocumentError("FILE_TARGET_CHANGED");
      const prefix = await t.io.inspectFile(
        c.temporaryPath,
        guard,
        c.receivedBytes,
      );
      if (
        prefix.stat.size > c.manifest.size ||
        JSON.stringify(prefix.hashes) !==
          JSON.stringify(
            c.manifest.hashes.slice(
              0,
              Math.ceil(c.receivedBytes / UPLOAD_CHUNK_BYTES),
            ),
          )
      )
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      const unlock = this.ports.locks.acquire(t.key + "\0" + c.canonicalPath);
      let release: (() => void) | undefined;
      try {
        release = this.ports.beginWrite(actor.userId, t, takeover);
        guard();
        await t.io.remove(c.temporaryPath, guard);
      } finally {
        release?.();
        unlock();
      }
    }
    await this.ports.audit(
      actor.userId,
      discard ? "upload.recovery_discarded" : "upload.recovery_reconciled",
      { checkpointId: c.id, path: c.canonicalPath },
    );
    return result;
  }
  async suspend(
    actor: UploadActor,
    id: string,
    persist: (checkpoint: UploadCheckpoint) => Promise<void>,
  ) {
    const checkpoint = this.checkpoint(actor, id),
      r = this.owned(actor, id);
    r.suspending = true;
    try {
      await persist(checkpoint);
      r.cancelRequested = true;
      r.release?.();
      r.release = undefined;
      this.records.delete(id);
      return { id, receivedBytes: r.view.receivedBytes };
    } finally {
      r.suspending = false;
    }
  }
  /** Only an owned, decrypted checkpoint may enter here. No old write lease is restored. */
  async restore(
    actor: UploadActor,
    raw: unknown,
    sessionId: string,
    manifestInput: unknown,
    overwrite = false,
  ): Promise<UploadView> {
    const c = uploadCheckpointSchema.parse(raw),
      manifest = uploadManifestSchema.parse(manifestInput);
    this.alive(actor);
    if (c.userId !== actor.userId) throw new DocumentError("UPLOAD_NOT_FOUND");
    if (JSON.stringify(manifest) !== JSON.stringify(c.manifest))
      throw new DocumentError("UPLOAD_SOURCE_CHANGED");
    if (c.baseline && !overwrite)
      throw new DocumentError("UPLOAD_OVERWRITE_REQUIRED");
    const duplicate = () =>
      [...this.records.values()].some(
        (r) =>
          r.targetKey === c.targetKey &&
          r.view.temporaryPath === c.temporaryPath,
      );
    if (duplicate()) throw new DocumentError("UPLOAD_RECOVERY_IN_USE");
    const reservation = Symbol(),
      bytes = c.manifest.hashes.length * 64;
    if (
      this.records.size + this.reservations.size >= 128 ||
      [...this.records.values()].filter(
        (r) => r.owner === actor.userId && !terminal(r.view.state),
      ).length +
        [...this.reservations.values()].filter((r) => r.userId === actor.userId)
          .length >=
        64 ||
      [...this.records.values()].reduce(
        (n, r) => n + r.manifest.hashes.length * 64,
        0,
      ) +
        [...this.reservations.values()].reduce((n, r) => n + r.bytes, 0) +
        bytes >
        8 * 1024 * 1024
    )
      throw new DocumentError("UPLOAD_LIMIT");
    this.reservations.set(reservation, { userId: actor.userId, bytes });
    try {
      const t = await this.ports.target(actor.userId, sessionId),
        view: UploadView = {
          id: randomUUID(),
          sessionId,
          path: c.path,
          canonicalPath: c.canonicalPath,
          hostIdentity: t.hostScope?.identity,
          name: c.manifest.name,
          totalBytes: c.manifest.size,
          receivedBytes: c.receivedBytes,
          chunkBytes: UPLOAD_CHUNK_BYTES,
          state: "paused",
          existing: c.baseline
            ? {
                size: c.baseline.stat.size,
                mtime: c.baseline.stat.mtime,
                mode: c.baseline.stat.mode & 0o7777,
              }
            : undefined,
          temporaryPath: c.temporaryPath,
          createdAt: Date.now(),
          expiresAt: Date.now() + idleTime,
        };
      const r: RecordState = {
        owner: actor.userId,
        targetKey: c.targetKey,
        acceptedHostKey: c.acceptedHostKey,
        connection: t.connection,
        manifest: structuredClone(c.manifest),
        baseline: c.baseline ? structuredClone(c.baseline) : undefined,
        constraint: c.constraint ? structuredClone(c.constraint) : undefined,
        requestKey: JSON.stringify([actor.userId, randomUUID()]),
        view,
        pending: 0,
        busy: false,
        stageCreated: true,
        creationAttempted: true,
        cancelRequested: false,
        pauseRequested: false,
        tail: Promise.resolve(),
      };
      this.verifyTarget(r, t, true);
      if (r.constraint) await this.constrainedParents(actor, t, r.constraint);
      const guard = this.guard(actor, r, t);
      await this.unchanged(actor, r, t);
      if (
        (await t.io.resolve(c.temporaryPath)) !== c.temporaryPath ||
        (await t.io.stat(c.temporaryPath)).kind !== "file"
      )
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      const prefix = await t.io.inspectFile(
        c.temporaryPath,
        guard,
        c.receivedBytes,
      );
      if (
        prefix.stat.size < c.receivedBytes ||
        prefix.stat.size > c.manifest.size ||
        JSON.stringify(prefix.hashes) !==
          JSON.stringify(
            c.manifest.hashes.slice(
              0,
              Math.ceil(c.receivedBytes / UPLOAD_CHUNK_BYTES),
            ),
          )
      )
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      guard();
      if (duplicate()) throw new DocumentError("UPLOAD_RECOVERY_IN_USE");
      await this.ports.audit(actor.userId, "upload.recovery_verified", {
        id: view.id,
        checkpointId: c.id,
        path: c.canonicalPath,
        receivedBytes: c.receivedBytes,
      });
      guard();
      if (duplicate()) throw new DocumentError("UPLOAD_RECOVERY_IN_USE");
      this.records.set(view.id, r);
      return structuredClone(view);
    } finally {
      this.reservations.delete(reservation);
    }
  }
  resume(actor: UploadActor, id: string, sessionId: string, takeover = false) {
    return this.mutate(actor, id, ["paused", "failed"], async (r) => {
      r.pauseRequested = false;
      if (
        !r.stageCreated ||
        !r.view.temporaryPath ||
        r.view.commitMayHaveOccurred
      )
        throw new DocumentError("UPLOAD_STATE_INVALID");
      const t = await this.target(actor, r, sessionId, true);
      this.hold(actor, r, t, takeover);
      const guard = this.guard(actor, r, t);
      await this.unchanged(actor, r, t);
      const prefix = await t.io.inspectFile(
        r.view.temporaryPath,
        guard,
        r.view.receivedBytes,
      );
      if (
        JSON.stringify(prefix.hashes) !==
        JSON.stringify(
          r.manifest.hashes.slice(
            0,
            Math.ceil(r.view.receivedBytes / UPLOAD_CHUNK_BYTES),
          ),
        )
      )
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      if (prefix.stat.size > r.view.receivedBytes)
        await t.io.truncate(r.view.temporaryPath, r.view.receivedBytes, guard);
      guard();
      r.connection = t.connection;
      r.view.sessionId = sessionId;
      r.view.state = "uploading";
      r.view.error = undefined;
      await this.ports.audit(actor.userId, "upload.resumed", {
        id,
        receivedBytes: r.view.receivedBytes,
      });
    });
  }
  finish(actor: UploadActor, id: string) {
    const r = this.owned(actor, id);
    if (r.view.state === "completed" || r.view.state === "unknown")
      return Promise.resolve(structuredClone(r.view));
    return this.mutate(actor, id, ["uploading"], async (r) => {
      if (r.view.receivedBytes !== r.view.totalBytes)
        throw new DocumentError("UPLOAD_INCOMPLETE");
      r.view.state = "verifying";
      const t = await this.target(actor, r),
        guard = this.guard(actor, r, t),
        staged = await t.io.inspectFile(r.view.temporaryPath!, guard);
      if (
        staged.bytes !== r.manifest.size ||
        JSON.stringify(staged.hashes) !== JSON.stringify(r.manifest.hashes)
      )
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      await this.unchanged(actor, r, t);
      await this.ports.audit(actor.userId, "upload.commit", {
        id,
        path: r.view.canonicalPath,
        temporaryPath: r.view.temporaryPath,
        bytes: staged.bytes,
      });
      guard();
      r.view.state = "committing";
      r.view.commitMayHaveOccurred = true;
      const committed = await t.io.replace(
        r.view.temporaryPath!,
        r.view.canonicalPath,
        !!r.baseline,
        guard,
      );
      r.view.temporaryPath = undefined;
      if ((await t.io.resolve(r.view.path)) !== r.view.canonicalPath)
        throw new DocumentError("FILE_POST_SAVE_CHANGED");
      const actual = await t.io.inspectFile(r.view.canonicalPath, guard);
      if (actual.sha256 !== staged.sha256 || actual.bytes !== r.manifest.size)
        throw new DocumentError("FILE_POST_SAVE_CHANGED");
      guard();
      await this.ports.audit(actor.userId, "upload.completed", {
        id,
        path: r.view.canonicalPath,
        bytes: actual.bytes,
        verification: "sha256",
      });
      r.view.state = "completed";
      r.view.verification = "sha256";
      r.view.sha256 = actual.sha256;
      r.view.atomic = committed.atomic;
      r.view.commitMayHaveOccurred = false;
      r.view.error = undefined;
      r.release?.();
      r.release = undefined;
    });
  }
  cancel(actor: UploadActor, id: string, cleanup = false) {
    const r = this.owned(actor, id);
    if (r.suspending) throw new DocumentError("UPLOAD_BUSY");
    if (["completed", "unknown", "committing"].includes(r.view.state))
      return Promise.resolve(structuredClone(r.view));
    r.cancelRequested = true;
    return this.mutate(
      actor,
      id,
      ["preview", "uploading", "paused", "failed", "cancelled", "expired"],
      async (r) => {
        r.release?.();
        r.release = undefined;
        if (cleanup && r.view.temporaryPath && !r.view.commitMayHaveOccurred) {
          if (!r.stageCreated)
            throw new DocumentError("UPLOAD_TEMPORARY_UNVERIFIED");
          const t = await this.ports.target(actor.userId, r.view.sessionId);
          this.verifyTarget(r, t, true);
          if (
            (await t.io.resolve(posix.dirname(r.view.temporaryPath))) !==
            posix.dirname(r.view.temporaryPath)
          )
            throw new DocumentError("FILE_TARGET_CHANGED");
          if (
            !posix.basename(r.view.temporaryPath).startsWith(".tandem-upload-")
          )
            throw new DocumentError("UPLOAD_STATE_INVALID");
          try {
            await t.io.remove(r.view.temporaryPath, () => {
              if (actor.signal?.aborted)
                throw new DocumentError("UPLOAD_REQUEST_CANCELLED");
              t.check("write", r.view.path, r.view.canonicalPath);
            });
            r.view.temporaryPath = undefined;
          } catch (error) {
            if (code(error) !== "FILE_NOT_FOUND") throw error;
            r.view.temporaryPath = undefined;
          }
        }
        r.view.state = "cancelled";
        r.view.error = undefined;
        await this.ports.audit(actor.userId, "upload.cancelled", {
          id,
          temporaryPath: r.view.temporaryPath,
          receivedBytes: r.view.receivedBytes,
        });
      },
    );
  }
}
