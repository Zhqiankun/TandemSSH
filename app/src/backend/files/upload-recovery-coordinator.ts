import { z } from "zod";
import type { UploadActor, UploadService } from "./upload-service.js";
import type { UploadCheckpoint } from "./upload-checkpoint.js";
import type {
  UploadRecoveryRecord,
  UploadRecoveryStore,
} from "./upload-recovery-store.js";
import type {
  UploadRecoverySummary,
  RestoredUpload,
} from "../../types/upload-recovery.js";
interface WindowScope {
  userId?: string;
  stop: AbortController;
  pending: Set<Promise<unknown>>;
}
interface Binding {
  token: string;
  userId: string;
  recordId: string;
  claimId: string;
  uploadId: string;
  work?: Promise<unknown>;
}
export class UploadRecoveryCoordinator {
  private windows = new Map<string, WindowScope>();
  private active = new Map<string, Binding>();
  private aliases = new Map<string, { userId: string; recordId: string }>();
  private pendingRelease = new Map<
    string,
    { binding: Binding; checkpoint?: UploadCheckpoint; state: string }
  >();
  constructor(
    private uploads: UploadService,
    private store: UploadRecoveryStore,
    private available: () => boolean,
  ) {}
  bind(token: string) {
    if (!this.available()) throw Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED");
    z.string().uuid().parse(token);
    if (this.windows.size >= 16 && !this.windows.has(token))
      throw Error("UPLOAD_RECOVERY_BUSY");
    if (!this.windows.has(token))
      this.windows.set(token, {
        stop: new AbortController(),
        pending: new Set(),
      });
    return { bound: true };
  }
  private scope(actor: UploadActor, token: string) {
    const w = this.windows.get(token);
    if (!this.available() || !w || w.stop.signal.aborted)
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
    if (w.userId && w.userId !== actor.userId)
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
    w.userId = actor.userId;
    return w;
  }
  private async call<T>(
    actor: UploadActor,
    token: string,
    work: (actor: UploadActor) => Promise<T>,
  ): Promise<T> {
    const w = this.scope(actor, token),
      signal = actor.signal
        ? AbortSignal.any([actor.signal, w.stop.signal])
        : w.stop.signal;
    const task = Promise.resolve().then(() => work({ ...actor, signal }));
    w.pending.add(task);
    try {
      const result = await task;
      if (signal.aborted) throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
      return result;
    } finally {
      w.pending.delete(task);
    }
  }
  private summary(r: UploadRecoveryRecord): UploadRecoverySummary {
    return {
      id: r.id,
      name: r.checkpoint.manifest.name,
      path: r.checkpoint.path,
      hostIdentity: r.checkpoint.hostIdentity,
      size: r.checkpoint.manifest.size,
      receivedBytes:
        r.state === "completed"
          ? r.checkpoint.manifest.size
          : r.checkpoint.receivedBytes,
      updatedAt: r.updatedAt,
      existing: !!r.checkpoint.baseline,
      state: this.store.interrupted(r) ? "interrupted" : r.state,
    };
  }
  private async retryReleases(user: string) {
    for (const [id, p] of this.pendingRelease)
      if (p.binding.userId === user) {
        try {
          const current = await this.store.get(user, id);
          if (
            !current ||
            ["completed", "cancelled"].includes(current.state) ||
            (current.state === "unknown" &&
              ["unknown", "committing"].includes(p.state))
          ) {
            this.pendingRelease.delete(id);
            continue;
          }
          if (p.state === "completed")
            await this.store.transition(
              user,
              id,
              p.binding.claimId,
              "completed",
            );
          else if (p.state === "unknown" || p.state === "committing")
            await this.store.transition(user, id, p.binding.claimId, "unknown");
          else if (p.checkpoint)
            await this.store.update(user, id, p.binding.claimId, p.checkpoint);
          else
            await this.store.transition(
              user,
              id,
              p.binding.claimId,
              "available",
            );
          this.pendingRelease.delete(id);
        } catch {
          /* Retain stopped-task evidence for the next retry. */
        }
      }
  }
  async close(token: string) {
    const w = this.windows.get(token);
    if (!w) return { closed: true };
    this.windows.delete(token);
    w.stop.abort();
    await Promise.allSettled([...w.pending]);
    for (const [id, b] of this.active)
      if (b.token === token) {
        if (b.work) await b.work.catch(() => {});
        if (this.active.get(id) !== b) continue;
        try {
          const saved = await this.uploads.preserve({ userId: b.userId }, id);
          this.pendingRelease.set(b.recordId, {
            binding: b,
            checkpoint: saved.checkpoint,
            state: saved.view.state,
          });
          this.active.delete(id);
          await this.retryReleases(b.userId);
        } catch {
          /* A running commit or failed persistence remains unavailable for another writer. */
        }
      }
    for (const [id, a] of this.aliases)
      if (a.userId === w.userId) this.aliases.delete(id);
    return { closed: true };
  }
  dispose() {
    for (const token of this.windows.keys()) void this.close(token);
  }
  assertActive(actor: UploadActor, id: string) {
    const b = this.active.get(id);
    if (b && (b.userId !== actor.userId || !this.windows.has(b.token)))
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
  }
  list(actor: UploadActor, token: string) {
    return this.call(actor, token, async (a) => {
      await this.retryReleases(a.userId);
      return (await this.store.list(a.userId)).map((r) => this.summary(r));
    });
  }
  detail(actor: UploadActor, token: string, id: string) {
    return this.call(actor, token, async (a) => {
      const r = await this.store.get(a.userId, id);
      if (!r) throw Error("UPLOAD_RECOVERY_NOT_FOUND");
      return { summary: this.summary(r), manifest: r.checkpoint.manifest };
    });
  }
  save(actor: UploadActor, token: string, id: string) {
    return this.call(actor, token, async (a) => {
      const binding = this.active.get(id);
      if (binding && binding.token !== token)
        throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
      const alias = this.aliases.get(id),
        old = await this.store.get(
          a.userId,
          alias?.userId === a.userId ? alias.recordId : id,
        );
      if (!binding && old) return this.summary(old);
      let result: UploadRecoveryRecord | undefined;
      await this.uploads.suspend(a, id, async (cp) => {
        result = binding
          ? await this.store.update(
              a.userId,
              binding.recordId,
              binding.claimId,
              cp,
            )
          : await this.store.create(a.userId, cp);
      });
      this.active.delete(id);
      this.aliases.set(id, { userId: a.userId, recordId: result!.id });
      while (this.aliases.size > 256)
        this.aliases.delete(this.aliases.keys().next().value!);
      return this.summary(result!);
    });
  }
  restore(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    manifest: unknown,
    overwrite: boolean,
  ) {
    return this.call(actor, token, async (a: UploadActor) => {
      await this.retryReleases(a.userId);
      const r = await this.store.claim(a.userId, id);
      let view;
      try {
        view = await this.uploads.restore(
          a,
          r.checkpoint,
          sessionId,
          manifest,
          overwrite,
        );
        if (a.signal?.aborted) {
          await this.uploads.preserve(a, view.id);
          throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
        }
        this.active.set(view.id, {
          token,
          userId: a.userId,
          recordId: id,
          claimId: r.claim!.id,
          uploadId: view.id,
        });
        return {
          view,
          manifest: r.checkpoint.manifest,
          summary: this.summary(r),
        } satisfies RestoredUpload;
      } catch (e) {
        await this.store
          .transition(a.userId, id, r.claim!.id, "available")
          .catch(() => {});
        throw e;
      }
    });
  }
  async finish(actor: UploadActor, id: string) {
    const b = this.active.get(id);
    if (!b) return this.uploads.finish(actor, id);
    this.assertActive(actor, id);
    if (b.work) return b.work;
    const work = (async () => {
      await this.store.transition(
        actor.userId,
        b.recordId,
        b.claimId,
        "committing",
      );
      const result = await this.uploads.finish(actor, id);
      const state =
        result.state === "completed"
          ? "completed"
          : result.commitMayHaveOccurred
            ? "unknown"
            : "claimed";
      await this.store.transition(actor.userId, b.recordId, b.claimId, state);
      if (state === "completed") this.active.delete(id);
      return result;
    })();
    b.work = work;
    try {
      return await work;
    } finally {
      b.work = undefined;
    }
  }
  async cancelled(
    actor: UploadActor,
    id: string,
    view: Awaited<ReturnType<UploadService["cancel"]>>,
  ) {
    const b = this.active.get(id);
    if (b && view.state === "cancelled") {
      if (view.temporaryPath) {
        const saved = await this.uploads.preserve(actor, id);
        if (saved.checkpoint)
          await this.store.update(
            actor.userId,
            b.recordId,
            b.claimId,
            saved.checkpoint,
          );
        else
          await this.store.transition(
            actor.userId,
            b.recordId,
            b.claimId,
            "available",
          );
      } else
        await this.store.transition(
          actor.userId,
          b.recordId,
          b.claimId,
          "cancelled",
        );
      this.active.delete(id);
    }
    return view;
  }
  check(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    takeover: boolean,
  ) {
    return this.call(actor, token, async (a) => {
      const r = await this.store.get(a.userId, id);
      if (!r || !["unknown", "committing"].includes(r.state))
        throw Error("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
      const b = [...this.active.values()].find(
        (b) => b.recordId === id && b.userId === a.userId,
      );
      if (b?.work) throw Error("UPLOAD_RECOVERY_BUSY");
      this.store.assertReconcile(r);
      const result = await this.uploads.reconcile(
        a,
        r.checkpoint,
        sessionId,
        takeover,
      );
      const updated = await this.store.checked(a.userId, id);
      const view =
        b && result
          ? this.uploads.reconciled(a, b.uploadId, result)
          : undefined;
      if (b) this.active.delete(b.uploadId);
      return { summary: this.summary(updated), view };
    });
  }
  discard(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    takeover: boolean,
  ) {
    return this.call(actor, token, async (a) => {
      const r = await this.store.claim(a.userId, id);
      try {
        await this.uploads.reconcile(
          a,
          r.checkpoint,
          sessionId,
          takeover,
          true,
        );
        return this.summary(
          await this.store.transition(a.userId, id, r.claim!.id, "cancelled"),
        );
      } catch (e) {
        await this.store.transition(a.userId, id, r.claim!.id, "available");
        throw e;
      }
    });
  }
  remove(actor: UploadActor, token: string, id: string) {
    return this.call(actor, token, async (a) => {
      await this.store.remove(a.userId, id);
      return { removed: true };
    });
  }
}
