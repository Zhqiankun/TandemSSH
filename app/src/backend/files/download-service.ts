import { createHash, randomUUID } from "node:crypto";
import {
  downloadCheckpointSchema,
  type DownloadCheckpoint,
} from "./download-checkpoint.js";
import { posix } from "node:path";
import { z } from "zod";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_CHUNKS,
  type DownloadSource,
  type PrepareDownload,
} from "../../types/file-download.js";
import type {
  FileDocumentTarget,
  RemoteFileStat,
  RemoteTransferIO,
} from "./ports.js";
export type DownloadTarget = FileDocumentTarget & { io: RemoteTransferIO };
export interface DownloadSourceConstraint {
  sha256?: string;
  hashes?: string[];
  key: string;
  peer?: string;
  canonicalPath: string;
  stat: RemoteFileStat;
}
export interface DownloadActor {
  userId: string;
  signal?: AbortSignal;
}
export interface DownloadPorts {
  target(userId: string, sessionId: string): Promise<DownloadTarget>;
  audit(
    userId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}
export const prepareDownloadSchema = z
  .object({
    requestId: z.string().uuid(),
    sessionId: z.string().min(1).max(256),
    path: z
      .string()
      .min(1)
      .max(4096)
      .startsWith("/")
      .refine((p) => p !== "/" && !/[\x00-\x1f\x7f]/.test(p)),
  })
  .strict();
interface RecordState {
  owner: string;
  requestKey: string;
  key: string;
  connection: string;
  peer?: string;
  stat: RemoteFileStat;
  view: DownloadSource;
  busy: boolean;
  cancelled: boolean;
  release?: () => void;
}
const attributes = (s: RemoteFileStat) =>
  JSON.stringify([s.kind, s.size, s.mtime, s.mode, s.uid, s.gid]);
const idleMs = 30 * 60 * 1000;
export class DownloadService {
  private readonly records = new Map<string, RecordState>();
  private readonly requests = new Map<
    string,
    { fingerprint: string; result: Promise<DownloadSource>; expires: number }
  >();
  private preparing = 0;
  private active = 0;
  private stopped = false;
  private readonly timer = setInterval(() => this.prune(), 60000);
  constructor(private readonly ports: DownloadPorts) {
    this.timer.unref?.();
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const r of this.records.values()) {
      r.cancelled = true;
      r.release?.();
      r.release = undefined;
    }
    this.records.clear();
    this.requests.clear();
  }
  private prune() {
    for (const [id, r] of this.records)
      if (!r.busy && r.view.expiresAt < Date.now()) {
        r.cancelled = true;
        r.release?.();
        this.records.delete(id);
      }
    for (const [key, r] of this.requests)
      if (r.expires < Date.now()) this.requests.delete(key);
  }
  private alive(actor: DownloadActor, r?: RecordState) {
    if (this.stopped || actor.signal?.aborted || r?.cancelled)
      throw Error("DOWNLOAD_CANCELLED");
    if (r && r.view.expiresAt < Date.now()) throw Error("DOWNLOAD_EXPIRED");
    if (r) r.view.expiresAt = Date.now() + idleMs;
  }
  private owned(actor: DownloadActor, id: string) {
    const r = this.records.get(id);
    if (!r || r.owner !== actor.userId) throw Error("DOWNLOAD_NOT_FOUND");
    return r;
  }
  touch(actor: DownloadActor, id: string) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    return structuredClone(r.view);
  }
  get(actor: DownloadActor, id: string) {
    return structuredClone(this.owned(actor, id).view);
  }
  prepare(
    actor: DownloadActor,
    raw: PrepareDownload,
    constraint?: DownloadSourceConstraint,
  ): Promise<DownloadSource> {
    this.prune();
    this.alive(actor);
    const input = prepareDownloadSchema.parse(raw),
      key = actor.userId + ":" + input.requestId,
      fingerprint = JSON.stringify({ input, constraint }),
      old = this.requests.get(key);
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw Error("DOWNLOAD_REQUEST_CONFLICT");
      return old.result.then((value) => this.get(actor, value.id));
    }
    if (
      this.records.size + this.preparing >= 128 ||
      this.requests.size >= 256 ||
      this.preparing >= 4
    )
      throw Error("DOWNLOAD_LIMIT");
    this.preparing++;
    const result = this.prepareNew(actor, input, constraint).finally(
      () => this.preparing--,
    );
    this.requests.set(key, {
      fingerprint,
      result,
      expires: Date.now() + idleMs,
    });
    return result;
  }
  private async prepareNew(
    actor: DownloadActor,
    input: PrepareDownload,
    constraint?: DownloadSourceConstraint,
  ) {
    const t = await this.ports.target(actor.userId, input.sessionId),
      release = t.retain?.();
    let retained = false;
    try {
      this.alive(actor);
      if (
        constraint &&
        (t.key !== constraint.key || t.acceptedHostKey !== constraint.peer)
      )
        throw Error("DOWNLOAD_HOST_IDENTITY_CHANGED");
      t.check("read", input.path, input.path);
      const canonicalPath = await t.io.resolve(input.path);
      if (!posix.isAbsolute(canonicalPath)) throw Error("FILE_PATH_INVALID");
      const guard = () => {
        this.alive(actor);
        t.check("read", input.path, canonicalPath);
      };
      guard();
      const meta = await t.io.stat(canonicalPath);
      if (meta.kind !== "file") throw Error("FILE_NOT_REGULAR");
      if (meta.size > DOWNLOAD_CHUNK_BYTES * DOWNLOAD_MAX_CHUNKS)
        throw Error("FILE_TOO_LARGE");
      const constrain = (stat: RemoteFileStat) => {
        if (!constraint) return;
        if (t.key !== constraint.key || t.acceptedHostKey !== constraint.peer)
          throw Error("DOWNLOAD_HOST_IDENTITY_CHANGED");
        if (
          canonicalPath !== constraint.canonicalPath ||
          attributes(stat) !== attributes(constraint.stat)
        )
          throw Error("DOWNLOAD_SOURCE_CHANGED");
      };
      constrain(meta);
      const inspected = await t.io.inspectFile(canonicalPath, guard);
      constrain(inspected.stat);
      if (
        constraint?.sha256 &&
        (inspected.sha256 !== constraint.sha256 ||
          (constraint.hashes &&
            (inspected.hashes.length !== constraint.hashes.length ||
              inspected.hashes.some((h, i) => h !== constraint.hashes![i]))))
      )
        throw Error("DOWNLOAD_SOURCE_CHANGED");
      guard();
      if ((await t.io.resolve(input.path)) !== canonicalPath)
        throw Error("DOWNLOAD_SOURCE_CHANGED");
      const view: DownloadSource = {
        id: randomUUID(),
        sessionId: input.sessionId,
        path: input.path,
        canonicalPath,
        hostIdentity: t.hostScope?.identity,
        size: inspected.bytes,
        sha256: inspected.sha256,
        hashes: inspected.hashes,
        chunkBytes: DOWNLOAD_CHUNK_BYTES,
        state: "ready",
        expiresAt: Date.now() + idleMs,
      };
      await this.ports.audit(actor.userId, "file.download.prepared", {
        id: view.id,
        path: canonicalPath,
        size: view.size,
        host: view.hostIdentity,
      });
      guard();
      this.records.set(view.id, {
        owner: actor.userId,
        requestKey: actor.userId + ":" + input.requestId,
        key: t.key,
        connection: t.connection,
        peer: t.acceptedHostKey,
        stat: inspected.stat,
        view,
        busy: false,
        cancelled: false,
        release,
      });
      retained = true;
      return structuredClone(view);
    } finally {
      if (!retained) release?.();
    }
  }
  private async target(
    actor: DownloadActor,
    r: RecordState,
    sessionId: string,
    reconnect: boolean,
  ) {
    this.alive(actor, r);
    const t = await this.ports.target(actor.userId, sessionId);
    if (t.key !== r.key || (!reconnect && t.connection !== r.connection))
      throw Error("FILE_CONNECTION_CHANGED");
    if (
      (r.peer && t.acceptedHostKey !== r.peer) ||
      (t.connection !== r.connection && (!r.peer || !t.acceptedHostKey))
    )
      throw Error("DOWNLOAD_HOST_IDENTITY_CHANGED");
    t.check("read", r.view.path, r.view.canonicalPath);
    if (
      (await t.io.resolve(r.view.path)) !== r.view.canonicalPath ||
      (await t.io.stat(r.view.canonicalPath)).kind !== "file"
    )
      throw Error("DOWNLOAD_SOURCE_CHANGED");
    return t;
  }
  private async run<T>(
    actor: DownloadActor,
    id: string,
    work: (r: RecordState) => Promise<T>,
  ) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (r.busy || this.active >= 4) throw Error("DOWNLOAD_BUSY");
    r.busy = true;
    this.active++;
    try {
      return await work(r);
    } finally {
      r.busy = false;
      this.active--;
    }
  }
  async chunk(actor: DownloadActor, id: string, offset: number) {
    return this.run(actor, id, async (r) => {
      if (r.view.state !== "ready") throw Error("DOWNLOAD_NOT_READY");
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= r.view.size ||
        offset % DOWNLOAD_CHUNK_BYTES
      )
        throw Error("DOWNLOAD_CHUNK_INVALID");
      const t = await this.target(actor, r, r.view.sessionId, false),
        guard = () => {
          this.alive(actor, r);
          t.check("read", r.view.path, r.view.canonicalPath);
        };
      const value = await t.io.readAt(
        r.view.canonicalPath,
        offset,
        Math.min(DOWNLOAD_CHUNK_BYTES, r.view.size - offset),
        guard,
      );
      guard();
      if (
        attributes(value.stat) !== attributes(r.stat) ||
        createHash("sha256").update(value.bytes).digest("hex") !==
          r.view.hashes[offset / DOWNLOAD_CHUNK_BYTES]
      )
        throw Error("DOWNLOAD_SOURCE_CHANGED");
      r.view.expiresAt = Date.now() + idleMs;
      return value.bytes;
    });
  }
  async pause(actor: DownloadActor, id: string) {
    return this.run(actor, id, async (r) => {
      r.view.state = "paused";
      r.release?.();
      r.release = undefined;
      return structuredClone(r.view);
    });
  }
  checkpoint(actor: DownloadActor, id: string): DownloadCheckpoint {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (r.busy || r.view.state !== "paused" || r.release)
      throw Error("DOWNLOAD_NOT_READY");
    if (!r.peer) throw Error("DOWNLOAD_HOST_IDENTITY_CHANGED");
    return this.snapshot(r);
  }
  recoveryMetadata(actor: DownloadActor, id: string) {
    const r = this.owned(actor, id);
    this.alive(actor, r);
    if (
      r.busy ||
      !["ready", "paused", "verified"].includes(r.view.state) ||
      !r.peer
    )
      throw Error("DOWNLOAD_NOT_READY");
    return this.snapshot(r);
  }
  private snapshot(r: RecordState): DownloadCheckpoint {
    return downloadCheckpointSchema.parse({
      schemaVersion: 1,
      id: r.view.id,
      userId: r.owner,
      targetKey: r.key,
      peer: r.peer,
      path: r.view.path,
      canonicalPath: r.view.canonicalPath,
      stat: r.stat,
      sha256: r.view.sha256,
      hashes: r.view.hashes,
      chunkBytes: DOWNLOAD_CHUNK_BYTES,
      savedAt: Date.now(),
    });
  }
  /** Called only after an authenticated recovery coordinator decrypts the owned checkpoint. */
  restore(
    actor: DownloadActor,
    raw: unknown,
    sessionId: string,
    requestId: string,
  ): Promise<DownloadSource> {
    const checkpoint = downloadCheckpointSchema.parse(raw);
    if (checkpoint.userId !== actor.userId) throw Error("DOWNLOAD_NOT_FOUND");
    return this.prepare(
      actor,
      { sessionId, requestId, path: checkpoint.path },
      {
        key: checkpoint.targetKey,
        peer: checkpoint.peer,
        canonicalPath: checkpoint.canonicalPath,
        stat: checkpoint.stat,
        sha256: checkpoint.sha256,
        hashes: checkpoint.hashes,
      },
    );
  }
  async verify(actor: DownloadActor, id: string, sessionId?: string) {
    return this.run(actor, id, async (r) => {
      const reconnect = sessionId !== undefined,
        nextSession = sessionId ?? r.view.sessionId;
      const t = await this.target(actor, r, nextSession, reconnect),
        release = t.retain?.();
      try {
        const guard = () => {
          this.alive(actor, r);
          t.check("read", r.view.path, r.view.canonicalPath);
        };
        const full = await t.io.inspectFile(r.view.canonicalPath, guard);
        if (
          full.sha256 !== r.view.sha256 ||
          attributes(full.stat) !== attributes(r.stat) ||
          (await t.io.resolve(r.view.path)) !== r.view.canonicalPath
        )
          throw Error("DOWNLOAD_SOURCE_CHANGED");
        await this.ports.audit(
          actor.userId,
          reconnect ? "file.download.resumed" : "file.download.source_verified",
          { id, path: r.view.canonicalPath, size: full.bytes },
        );
        guard();
        r.view.state = reconnect ? "ready" : "verified";
        r.view.sessionId = nextSession;
        r.connection = t.connection;
        r.view.expiresAt = Date.now() + idleMs;
        r.release?.();
        r.release = reconnect ? t.retain?.() : undefined;
        return structuredClone(r.view);
      } finally {
        release?.();
      }
    });
  }
  forget(actor: DownloadActor, id: string) {
    const r = this.owned(actor, id);
    if (r.busy) throw Error("DOWNLOAD_BUSY");
    if (!["verified", "cancelled"].includes(r.view.state) || r.release)
      throw Error("DOWNLOAD_NOT_READY");
    r.cancelled = true;
    this.records.delete(id);
    // Explicitly clearing a preview revokes its request cache too; another download must prepare afresh.
    this.requests.delete(r.requestKey);
    return structuredClone(r.view);
  }
  async cancel(actor: DownloadActor, id: string) {
    const r = this.owned(actor, id);
    r.cancelled = true;
    r.view.state = "cancelled";
    r.release?.();
    r.release = undefined;
    await this.ports.audit(actor.userId, "file.download.cancelled", {
      id,
      path: r.view.canonicalPath,
    });
    return structuredClone(r.view);
  }
}
