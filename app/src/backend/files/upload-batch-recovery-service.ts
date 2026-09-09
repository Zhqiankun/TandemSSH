import type { UploadActor, UploadService } from "./upload-service.js";
import type { UploadTreeService } from "./upload-tree-service.js";
import type { UploadRecoveryCoordinator } from "./upload-recovery-coordinator.js";
import type { UploadBatchSourcePort } from "./upload-batch-native-client.js";
import type {
  UploadBatchRecord,
  UploadBatchSnapshot,
} from "./upload-batch-snapshot.js";
import type { UploadBatchRecoveryStore } from "./upload-batch-recovery-store.js";
import type {
  UploadBatchRecoverySummary,
  RestoredUploadBatch,
} from "../../types/upload-batch-recovery.js";
import type {
  UploadManifest,
  UploadView,
  StartUpload,
} from "../../types/file-upload.js";
import type {
  UploadFileResult,
  UploadTreeAction,
} from "../../types/upload-tree.js";
interface Binding {
  id: string;
  userId: string;
  token: string;
  claimId: string;
  treeId: string;
  sourceId: string;
  files: Map<string, string>;
  ready: Set<string>;
  tail: Promise<unknown>;
  closing: boolean;
  saved?: Array<{
    entry: string;
    state: "pending" | "paused" | "unknown" | "completed";
    checkpoint?: ReturnType<UploadService["captureRecovery"]>;
    result?: UploadFileResult;
  }>;
}
export class UploadBatchRecoveryService {
  private active = new Map<string, Binding>();
  private treesById = new Map<string, Binding>();
  private filesById = new Map<string, Binding>();
  private releases = new Map<string, { user: string; claim: string }>();
  constructor(
    private uploads: UploadService,
    private trees: UploadTreeService,
    private store: UploadBatchRecoveryStore,
    private windows: UploadRecoveryCoordinator,
    private native: UploadBatchSourcePort,
  ) {
    windows.onWindowClose((token) => this.close(token));
  }
  private summary(r: UploadBatchRecord): UploadBatchRecoverySummary {
    const entries = r.payload.tree.entries.map((e) => e.view);
    return {
      id: r.id,
      name: entries
        .filter((e) => !e.parentId)
        .map((e) => e.name)
        .join(", "),
      path: r.payload.tree.path,
      hostIdentity: r.payload.tree.hostIdentity,
      entries: entries.length,
      completed: entries.filter(
        (e) =>
          !!e.fileResult ||
          ["created", "merged"].includes(e.result?.state ?? ""),
      ).length,
      paused: r.payload.members.filter((e) => e.state === "paused").length,
      unknown:
        r.payload.members.filter((e) =>
          ["unknown", "committing"].includes(e.state),
        ).length + entries.filter((e) => e.result?.state === "unknown").length,
      existing: entries.some((e) => e.status === "conflict" && !e.fileResult),
      state: this.store.interrupted(r) ? "interrupted" : r.state,
      updatedAt: r.updatedAt,
    };
  }
  private async retry(user: string) {
    for (const [id, r] of this.releases)
      if (r.user === user) {
        try {
          const current = await this.store.get(user, id);
          if (
            current &&
            ["completed", "cancelled", "available"].includes(current.state)
          ) {
            this.releases.delete(id);
            continue;
          }
          await this.store.change(user, id, r.claim, (row) => {
            row.state = "available";
            delete row.claim;
            this.finished(row);
          });
          this.releases.delete(id);
        } catch {
          /* Retry the durable release on the next explicit refresh. */
        }
      }
    for (const b of [...this.active.values()])
      if (b.userId === user) {
        try {
          this.windows.assertWindow({ userId: user }, b.token);
        } catch {
          await this.close(b.token);
        }
      }
  }
  private member(row: UploadBatchRecord, entry: string) {
    const m = row.payload.members.find((e) => e.entryId === entry);
    if (!m) throw Error("UPLOAD_BATCH_MEMBER_INVALID");
    return m;
  }
  private finished(row: UploadBatchRecord) {
    if (
      row.payload.members.every(
        (m) =>
          m.state === "completed" || (m.state === "cancelled" && !m.checkpoint),
      ) &&
      row.payload.tree.entries.every(
        (e) =>
          e.view.kind !== "directory" ||
          (e.view.action === "skip" && e.view.result?.state !== "unknown") ||
          ["created", "merged"].includes(e.view.result?.state ?? ""),
      )
    ) {
      row.state = "completed";
      delete row.claim;
    }
  }
  private bind(b: Binding) {
    this.active.set(b.userId + "\0" + b.id, b);
    this.treesById.set(b.treeId, b);
    for (const id of b.files.keys()) this.filesById.set(id, b);
  }
  private unbind(b: Binding) {
    this.active.delete(b.userId + "\0" + b.id);
    this.treesById.delete(b.treeId);
    for (const id of b.files.keys()) this.filesById.delete(id);
  }
  ownsFile(id: string) {
    return this.filesById.has(id);
  }
  ownsTree(id: string) {
    return this.treesById.has(id);
  }
  assertActive(actor: UploadActor, id: string) {
    const b = this.filesById.get(id);
    if (b) {
      if (b.userId !== actor.userId || b.closing)
        throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
      this.windows.assertWindow(actor, b.token);
    }
  }
  assertTree(actor: UploadActor, id: string) {
    const b = this.treesById.get(id);
    if (b) {
      if (b.userId !== actor.userId || b.closing)
        throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
      this.windows.assertWindow(actor, b.token);
    }
  }
  assertChunk(actor: UploadActor, id: string) {
    this.assertActive(actor, id);
    const b = this.filesById.get(id);
    if (b && !b.ready.has(id)) throw Error("UPLOAD_BATCH_BUSY");
  }
  private serial<T>(
    b: Binding,
    actor: UploadActor,
    work: () => Promise<T>,
  ): Promise<T> {
    this.assertTree(actor, b.treeId);
    const next = b.tail
      .catch(() => {})
      .then(() => {
        this.assertTree(actor, b.treeId);
        return work();
      });
    b.tail = next;
    return next;
  }
  list(actor: UploadActor, token: string) {
    return this.windows.withWindow(actor, token, async (a) => {
      await this.retry(a.userId);
      return (await this.store.list(a.userId)).map((r) => this.summary(r));
    });
  }
  detail(actor: UploadActor, token: string, id: string) {
    return this.windows.withWindow(actor, token, async (a) => {
      const r = await this.store.get(a.userId, id);
      if (!r) throw Error("UPLOAD_BATCH_NOT_FOUND");
      return {
        summary: this.summary(r),
        entries: r.payload.tree.entries.map((e) => e.view),
        members: r.payload.members.map((m) => ({
          entryId: m.entryId,
          state: m.state,
        })),
      };
    });
  }
  save(
    actor: UploadActor,
    token: string,
    input: {
      id: string;
      treeId: string;
      sourceId: string;
      members: Array<{
        entryId: string;
        uploadId?: string;
        cancelled?: boolean;
      }>;
    },
  ) {
    return this.windows.withWindow(actor, token, async (a) => {
      await this.retry(a.userId);
      const existing = await this.store.get(a.userId, input.id),
        binding = this.treesById.get(input.treeId);
      if (existing && !binding) {
        if (existing.payload.tree.id !== input.treeId)
          throw Error("UPLOAD_BATCH_CONFLICT");
        return this.summary(existing);
      }
      if (binding && (binding.id !== input.id || binding.token !== token))
        throw Error("UPLOAD_BATCH_CONFLICT");
      if (binding) await binding.tail.catch(() => {});
      const selected = await this.native.snapshot(token, input.sourceId),
        view = this.trees.get(a, input.treeId),
        sourceEntries = new Map(
          selected.selection.entries.map((e) => [e.id, e]),
        );
      for (const e of view.entries) {
        const source = sourceEntries.get(e.id);
        if (
          !source ||
          source.kind !== e.kind ||
          source.size !== e.size ||
          source.lastModified !== e.lastModified
        )
          throw Error("UPLOAD_BATCH_SOURCE_CHANGED");
      }
      if (
        new Set(input.members.map((m) => m.entryId)).size !==
        input.members.length
      )
        throw Error("UPLOAD_BATCH_MEMBER_INVALID");
      const inputs = new Map(input.members.map((m) => [m.entryId, m]));
      for (const m of input.members)
        if (!view.entries.some((e) => e.id === m.entryId && e.kind === "file"))
          throw Error("UPLOAD_BATCH_MEMBER_INVALID");
      let saved: UploadBatchRecord | undefined;
      const ids = input.members.flatMap((m) => {
        const e = view.entries.find((e) => e.id === m.entryId)!;
        if (!m.uploadId || e.fileResult) return [];
        this.uploads.assertTreeMember(
          a,
          m.uploadId,
          existing?.payload.tree.lineageId ??
            existing?.payload.tree.id ??
            this.trees.checkpoint(a, input.treeId).lineageId ??
            input.treeId,
          m.entryId,
        );
        return [m.uploadId];
      });
      await this.trees.suspend(a, input.treeId, (tree) =>
        this.uploads
          .suspendBatch(a, ids, async (snapshots) => {
            const transfers = new Map(snapshots.map((m) => [m.id, m]));
            const members: UploadBatchSnapshot["members"] = tree.entries
              .filter((e) => e.view.kind === "file")
              .map(({ view: e }) => {
                if (e.fileResult) return { entryId: e.id, state: "completed" };
                const input = inputs.get(e.id),
                  transfer = input?.uploadId
                    ? transfers.get(input.uploadId)
                    : undefined;
                const old = existing?.payload.members.find(
                  (m) => m.entryId === e.id,
                );
                if (
                  transfer?.state === "unknown" ||
                  (old && ["unknown", "committing"].includes(old.state))
                )
                  return {
                    entryId: e.id,
                    state: "unknown",
                    checkpoint: transfer?.checkpoint ?? old?.checkpoint,
                  };
                if (e.action === "skip" || input?.cancelled)
                  return {
                    entryId: e.id,
                    state: "cancelled",
                    checkpoint:
                      transfer?.checkpoint ??
                      existing?.payload.members.find((m) => m.entryId === e.id)
                        ?.checkpoint,
                  };
                return {
                  entryId: e.id,
                  state: transfer?.state ?? old?.state ?? "pending",
                  checkpoint:
                    transfer?.checkpoint ??
                    existing?.payload.members.find((m) => m.entryId === e.id)
                      ?.checkpoint,
                };
              });
            const payload = {
              tree,
              source: existing?.payload.source ?? selected.snapshot,
              members,
            };
            if (binding)
              saved = await this.store.change(
                a.userId,
                binding.id,
                binding.claimId,
                (r) => {
                  r.payload = payload;
                },
              );
            else saved = await this.store.create(a.userId, input.id, payload);
          })
          .then(() => {}),
      );
      if (!saved) throw Error("UPLOAD_BATCH_SAVE_FAILED");
      if (binding) this.unbind(binding);
      this.releases.set(saved.id, { user: a.userId, claim: saved.claim!.id });
      await this.retry(a.userId);
      await this.native.forget(token, input.sourceId).catch(() => {});
      return this.summary((await this.store.get(a.userId, saved.id))!);
    });
  }
  restore(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    sourceId: string,
    reviewed: boolean,
    overwrite: boolean,
  ) {
    return this.windows.withWindow(actor, token, async (a) => {
      if (!reviewed) throw Error("UPLOAD_BATCH_REVIEW_REQUIRED");
      await this.retry(a.userId);
      const row = await this.store.claim(a.userId, id);
      let treeId: string | undefined, restoredSource: string | undefined;
      const fileIds: string[] = [];
      try {
        if (this.summary(row).existing && !overwrite)
          throw Error("UPLOAD_OVERWRITE_REQUIRED");
        const source = await this.native.restore(
          token,
          sourceId,
          row.payload.source,
        );
        restoredSource = source.id;
        const preview = await this.trees.restore(
          a,
          row.payload.tree,
          sessionId,
        );
        treeId = preview.id;
        const old = new Map(
          row.payload.tree.entries.map((e) => [e.view.id, e.view]),
        );
        const choices = preview.entries.map((e) => ({
          id: e.id,
          action: (e.fileResult ||
          old.get(e.id)?.action === "skip" ||
          row.payload.members.find((m) => m.entryId === e.id)?.state ===
            "cancelled"
            ? "skip"
            : e.status === "directory"
              ? "merge"
              : e.status === "conflict"
                ? "overwrite"
                : "create") as UploadTreeAction,
        }));
        const tree = await this.trees.confirm(
            a,
            preview.id,
            preview.revision,
            choices,
          ),
          members: RestoredUploadBatch["members"] = [],
          files = new Map<string, string>();
        for (const m of row.payload.members) {
          if (a.signal?.aborted) throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
          if (m.state === "paused" && m.checkpoint) {
            const v = await this.uploads.restore(
              a,
              m.checkpoint,
              sessionId,
              m.checkpoint.manifest,
              overwrite,
            );
            fileIds.push(v.id);
            files.set(v.id, m.entryId);
            members.push({
              entryId: m.entryId,
              state: "paused",
              view: v,
              manifest: m.checkpoint.manifest,
            });
          } else
            members.push({
              entryId: m.entryId,
              state: m.state === "committing" ? "unknown" : m.state,
            });
        }
        await this.store.change(a.userId, id, row.claim!.id, (r) => {
          r.payload.tree = this.trees.checkpoint(a, tree.id);
        });
        const b: Binding = {
          id,
          userId: a.userId,
          token,
          claimId: row.claim!.id,
          treeId: tree.id,
          sourceId: source.id,
          files,
          ready: new Set(fileIds),
          tail: Promise.resolve(),
          closing: false,
        };
        this.bind(b);
        return {
          summary: this.summary(row),
          source,
          tree,
          members,
        } satisfies RestoredUploadBatch;
      } catch (error) {
        for (const id of fileIds)
          await this.uploads.preserve({ userId: a.userId }, id).catch(() => {});
        if (treeId) this.trees.releaseRecovery({ userId: a.userId }, treeId);
        if (restoredSource)
          await this.native.forget(token, restoredSource).catch(() => {});
        await this.store.release(a.userId, id, row.claim!.id).catch(() => {});
        throw error;
      }
    });
  }
  prepare(
    actor: UploadActor,
    treeId: string,
    entryId: string,
    sessionId: string,
    requestId: string,
    manifest: UploadManifest,
  ) {
    const b = this.treesById.get(treeId);
    if (!b)
      return this.trees.prepareEntry(
        actor,
        treeId,
        entryId,
        sessionId,
        requestId,
        manifest,
      );
    return this.serial(b, actor, async () => {
      const row = await this.store.get(actor.userId, b.id),
        m = row && this.member(row, entryId);
      if (!m || m.state !== "pending")
        throw Error("UPLOAD_BATCH_MEMBER_INVALID");
      const v = await this.trees.prepareEntry(
        actor,
        treeId,
        entryId,
        sessionId,
        requestId,
        manifest,
      );
      b.files.set(v.id, entryId);
      this.filesById.set(v.id, b);
      return v;
    });
  }
  start(actor: UploadActor, id: string, input: StartUpload) {
    const b = this.filesById.get(id);
    if (!b) return this.uploads.start(actor, id, input);
    return this.serial(b, actor, async () => {
      b.ready.delete(id);
      const v = await this.uploads.start(actor, id, input);
      if (v.state === "uploading") {
        const cp = this.uploads.captureRecovery(actor, id);
        await this.store.change(actor.userId, b.id, b.claimId, (r) => {
          Object.assign(this.member(r, b.files.get(id)!), {
            state: "paused",
            checkpoint: cp,
          });
        });
        b.ready.add(id);
      }
      return v;
    });
  }
  resume(
    actor: UploadActor,
    id: string,
    sessionId: string,
    takeover?: boolean,
  ) {
    const b = this.filesById.get(id);
    if (!b) return this.uploads.resume(actor, id, sessionId, takeover);
    return this.serial(b, actor, async () => {
      b.ready.delete(id);
      const v = await this.uploads.resume(actor, id, sessionId, takeover);
      if (v.state === "uploading") {
        const cp = this.uploads.captureRecovery(actor, id);
        await this.store.change(actor.userId, b.id, b.claimId, (r) => {
          Object.assign(this.member(r, b.files.get(id)!), {
            state: "paused",
            checkpoint: cp,
          });
        });
        b.ready.add(id);
      }
      return v;
    });
  }
  finish(actor: UploadActor, id: string) {
    const b = this.filesById.get(id);
    if (!b) return this.uploads.finish(actor, id);
    return this.serial(b, actor, async () => {
      b.ready.delete(id);
      const prior = this.uploads.get(actor, id);
      if (prior.state === "unknown") return prior;
      if (prior.state === "completed") {
        const row = await this.store.get(actor.userId, b.id);
        if (row?.state === "claimed") {
          const result = await this.trees.completeEntry(
            actor,
            b.treeId,
            b.files.get(id)!,
            id,
          );
          await this.recordResult(b, b.files.get(id)!, result);
        }
        return prior;
      }
      const cp = this.uploads.captureRecovery(actor, id),
        entry = b.files.get(id)!;
      await this.store.change(actor.userId, b.id, b.claimId, (r) => {
        Object.assign(this.member(r, entry), {
          state: "committing",
          checkpoint: cp,
        });
      });
      const v = await this.uploads.finish(actor, id);
      if (v.state === "completed") {
        const result = await this.trees.completeEntry(
          actor,
          b.treeId,
          entry,
          id,
        );
        await this.recordResult(b, entry, result);
      } else
        await this.store.change(actor.userId, b.id, b.claimId, (r) => {
          const m = this.member(r, entry);
          m.state = v.commitMayHaveOccurred ? "unknown" : "paused";
        });
      return v;
    });
  }
  private recordResult(b: Binding, entry: string, result: UploadFileResult) {
    return this.store.change(b.userId, b.id, b.claimId, (r) => {
      const e = r.payload.tree.entries.find((e) => e.view.id === entry)!;
      e.view.fileResult = result;
      Object.assign(this.member(r, entry), {
        state: "completed",
        checkpoint: undefined,
      });
      this.finished(r);
    });
  }
  complete(
    actor: UploadActor,
    treeId: string,
    entryId: string,
    uploadId: string,
  ) {
    const b = this.treesById.get(treeId);
    if (!b) return this.trees.completeEntry(actor, treeId, entryId, uploadId);
    this.assertTree(actor, treeId);
    return this.trees.completeEntry(actor, treeId, entryId, uploadId);
  }
  directories(actor: UploadActor, treeId: string, takeover: boolean) {
    const b = this.treesById.get(treeId);
    if (!b) return this.trees.directories(actor, treeId, takeover);
    return this.serial(b, actor, async () => {
      const results = await this.trees.directories(actor, treeId, takeover),
        tree = this.trees.checkpoint(actor, treeId);
      await this.store.change(actor.userId, b.id, b.claimId, (r) => {
        r.payload.tree = tree;
        this.finished(r);
      });
      return results;
    });
  }
  cancelled(actor: UploadActor, id: string, view: UploadView) {
    const b = this.filesById.get(id);
    if (!b || view.state !== "cancelled") return Promise.resolve(view);
    return this.serial(b, actor, async () => {
      let checkpoint;
      if (view.temporaryPath)
        checkpoint = (await this.uploads.preserve(actor, id)).checkpoint;
      await this.store.change(actor.userId, b.id, b.claimId, (r) => {
        Object.assign(this.member(r, b.files.get(id)!), {
          state: "cancelled",
          checkpoint,
        });
        this.finished(r);
      });
      b.files.delete(id);
      b.ready.delete(id);
      this.filesById.delete(id);
      return view;
    });
  }
  async close(token: string) {
    for (const b of [...this.active.values()])
      if (b.token === token) {
        b.closing = true;
        await b.tail.catch(() => {});
        let row: UploadBatchRecord | null;
        try {
          row = await this.store.get(b.userId, b.id);
        } catch {
          continue;
        }
        if (!row) {
          this.unbind(b);
          continue;
        }
        const patches: Array<{
          entry: string;
          state: "pending" | "paused" | "unknown" | "completed";
          checkpoint?: ReturnType<UploadService["captureRecovery"]>;
          result?: UploadFileResult;
        }> = b.saved ?? [];
        try {
          if (!b.saved)
            for (const [id, entry] of b.files) {
              let v: UploadView;
              try {
                v = this.uploads.get({ userId: b.userId }, id);
              } catch (error) {
                const m = this.member(row, entry);
                if (
                  m.state === "completed" ||
                  (m.state === "cancelled" && !m.checkpoint)
                )
                  continue;
                throw error;
              }
              let result: UploadFileResult | undefined;
              if (v.state === "completed")
                result = await this.trees.completeEntry(
                  { userId: b.userId },
                  b.treeId,
                  entry,
                  id,
                );
              const saved = await this.uploads.preserve(
                { userId: b.userId },
                id,
              );
              patches.push({
                entry,
                state: result
                  ? "completed"
                  : saved.checkpoint
                    ? "paused"
                    : saved.view.state === "unknown"
                      ? "unknown"
                      : "pending",
                checkpoint: saved.checkpoint,
                result,
              });
            }
          b.saved = patches;
          if (["claimed", "preparing"].includes(row.state))
            await this.store.change(b.userId, b.id, b.claimId, (r) => {
              for (const p of patches) {
                const m = this.member(r, p.entry);
                if (p.result) {
                  r.payload.tree.entries.find(
                    (e) => e.view.id === p.entry,
                  )!.view.fileResult = p.result;
                  m.state = "completed";
                  delete m.checkpoint;
                } else if (p.checkpoint) {
                  m.state = p.state;
                  m.checkpoint = p.checkpoint;
                } else if (m.state !== "committing" && m.state !== "unknown")
                  m.state = p.state;
              }
              r.state = "available";
              delete r.claim;
            });
          this.trees.releaseRecovery({ userId: b.userId }, b.treeId);
          this.unbind(b);
        } catch {
          /* Keep the durable claim and stopped runtime until a later close retry can finish. */
        }
      }
  }
  check(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    takeover: boolean,
  ) {
    return this.windows.withWindow(actor, token, async (a) => {
      const active = this.active.get(a.userId + "\0" + id);
      const run = async (b: Binding, row: UploadBatchRecord) => {
        await this.trees.reconcileDirectories(a, b.treeId);
        const directories = this.trees.directoryReceipts(a, b.treeId);
        if (directories.length)
          await this.store.change(a.userId, id, b.claimId, (r) => {
            for (const d of directories) {
              const e = r.payload.tree.entries.find(
                (e) => e.view.id === d.entryId,
              )!;
              e.directory = d.signature;
              e.view.status = "directory";
              e.view.result = d.result;
            }
          });
        for (const m of row.payload.members)
          if (["unknown", "committing"].includes(m.state) && m.checkpoint) {
            const result = await this.trees.reconcileMember(
              a,
              b.treeId,
              m.entryId,
              m.checkpoint,
              takeover,
            );
            const activeId = [...b.files].find(
              ([, entry]) => entry === m.entryId,
            )?.[0];
            if (activeId) this.uploads.reconciled(a, activeId, result);
            await this.recordResult(b, m.entryId, result);
          }
        let current = (await this.store.get(a.userId, id))!;
        if (current.state === "claimed")
          current = await this.store.change(a.userId, id, b.claimId, (r) =>
            this.finished(r),
          );
        return {
          summary: this.summary(current),
          tree: this.trees.get(a, b.treeId),
        };
      };
      if (active) {
        if (active.token !== token)
          throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
        return this.serial(active, a, async () =>
          run(active, (await this.store.get(a.userId, id))!),
        );
      }
      const row = await this.store.claim(a.userId, id);
      let treeId: string | undefined;
      try {
        const tree = await this.trees.restore(a, row.payload.tree, sessionId, {
          reconcileDirectories: true,
        });
        treeId = tree.id;
        return await run(
          {
            id,
            userId: a.userId,
            token,
            claimId: row.claim!.id,
            treeId,
            sourceId: "",
            files: new Map(),
            ready: new Set(),
            tail: Promise.resolve(),
            closing: false,
          },
          row,
        );
      } finally {
        if (treeId) this.trees.releaseRecovery({ userId: a.userId }, treeId);
        const current = await this.store.get(a.userId, id);
        if (current?.state === "claimed")
          await this.store.release(a.userId, id, row.claim!.id);
      }
    });
  }
  cancelTree(actor: UploadActor, treeId: string) {
    const b = this.treesById.get(treeId);
    if (!b) return Promise.resolve(this.trees.cancel(actor, treeId));
    return this.serial(b, actor, async () => {
      b.closing = true;
      b.ready.clear();
      const patches = [];
      for (const [id, entry] of b.files) {
        let v: UploadView;
        try {
          v = this.uploads.get(actor, id);
        } catch {
          continue;
        }
        const result =
          v.state === "completed"
            ? await this.trees.completeEntry(actor, treeId, entry, id)
            : undefined;
        const saved = await this.uploads.preserve(actor, id);
        patches.push({
          entry,
          result,
          checkpoint: saved.checkpoint,
          unknown: saved.view.state === "unknown",
        });
      }
      const view = this.trees.cancel(actor, treeId);
      await this.store.change(actor.userId, b.id, b.claimId, (r) => {
        for (const p of patches) {
          const m = this.member(r, p.entry);
          if (p.result) {
            r.payload.tree.entries.find(
              (e) => e.view.id === p.entry,
            )!.view.fileResult = p.result;
            m.state = "completed";
            delete m.checkpoint;
          } else if (p.checkpoint) {
            m.state = "cancelled";
            m.checkpoint = p.checkpoint;
          } else if (p.unknown) m.state = "unknown";
          else if (!["unknown", "committing"].includes(m.state)) {
            m.state = "cancelled";
            delete m.checkpoint;
          }
        }
        for (const m of r.payload.members) {
          if (m.state === "pending") m.state = "cancelled";
          if (m.state === "cancelled")
            r.payload.tree.entries.find(
              (e) => e.view.id === m.entryId,
            )!.view.action = "skip";
        }
        for (const e of r.payload.tree.entries)
          if (e.view.kind === "directory" && !e.view.result)
            e.view.action = "skip";
        r.state =
          r.payload.members.some((m) => m.checkpoint) ||
          r.payload.tree.entries.some((e) => e.view.result?.state === "unknown")
            ? "available"
            : "cancelled";
        delete r.claim;
      });
      this.unbind(b);
      return view;
    });
  }
  discard(
    actor: UploadActor,
    token: string,
    id: string,
    sessionId: string,
    takeover: boolean,
  ) {
    return this.windows.withWindow(actor, token, async (a) => {
      const r = await this.store.claim(a.userId, id);
      try {
        if (this.summary(r).unknown > 0)
          throw Error("UPLOAD_BATCH_RECONCILE_REQUIRED");
        for (const m of r.payload.members)
          if (m.checkpoint)
            await this.uploads.reconcile(
              a,
              m.checkpoint,
              sessionId,
              takeover,
              true,
            );
        const saved = await this.store.change(
          a.userId,
          id,
          r.claim!.id,
          (row) => {
            for (const m of row.payload.members) {
              if (m.state !== "completed") m.state = "cancelled";
              delete m.checkpoint;
            }
            row.state = "cancelled";
            delete row.claim;
          },
        );
        return this.summary(saved);
      } catch (error) {
        await this.store.release(a.userId, id, r.claim!.id).catch(() => {});
        throw error;
      }
    });
  }
  remove(actor: UploadActor, token: string, id: string) {
    return this.windows.withWindow(actor, token, async (a) => {
      const b = this.active.get(a.userId + "\0" + id);
      if (b) await b.tail.catch(() => {});
      await this.store.remove(a.userId, id);
      if (b) this.unbind(b);
      return { removed: true };
    });
  }
}
