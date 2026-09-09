const path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { DownloadBatchVault } = require("./download-batch-vault.cjs"),
  { batchRequest: rpc } = require("./download-batch-rpc.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function createDownloadBatchRecovery({
  sink,
  directories,
  recovery,
  root,
  crypto,
}) {
  const vault = new DownloadBatchVault({
      root: path.join(root, "batches"),
      crypto,
    }),
    active = new Map(),
    files = new Map(),
    aliases = new Map(),
    pendingRelease = new Map();
  const member = (row, id) => {
    const m = row.members.find((m) => m.entryId === id);
    if (!m) throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
    return m;
  };
  const finishRow = (row) => {
    if (
      row.members.every(
        (m) => m.state === "completed" || (m.state === "cancelled" && !m.local),
      ) &&
      row.target.entries.every(
        (e) =>
          e.kind !== "directory" ||
          (e.action === "skip" && e.result?.state !== "unknown") ||
          ["created", "merged"].includes(e.result?.state),
      )
    ) {
      row.state = "completed";
      delete row.claim;
    }
  };
  const bind = (b) => {
    active.set(b.targetId, b);
    for (const [id, m] of b.files) files.set(id, { b, m });
  };
  const unbind = (b) => {
    active.delete(b.targetId);
    for (const id of b.files.keys()) files.delete(id);
  };
  const valid = (b) => {
    if (b.stopping) throw Error("DOWNLOAD_CANCELLED");
    b.guard();
  };
  function assertFile(owner, id, operation) {
    const item = files.get(id);
    if (!item) return;
    if (item.b.owner !== owner) throw Error("DOWNLOAD_NOT_FOUND");
    valid(item.b);
    if (["start", "append", "resume"].includes(operation) && item.m.busy)
      throw Error("DOWNLOAD_BUSY");
  }
  function assertTree(owner, id) {
    const b = active.get(id);
    if (b) {
      if (b.owner !== owner) throw Error("DOWNLOAD_NOT_FOUND");
      valid(b);
    }
  }
  async function track(b, work) {
    valid(b);
    const p = Promise.resolve().then(work);
    b.work.add(p);
    try {
      return await p;
    } finally {
      b.work.delete(p);
    }
  }
  async function update(b, fn) {
    return vault.change(b.userId, b.id, b.claimId, fn);
  }
  async function retryRelease(user) {
    for (const [id, p] of pendingRelease)
      if (p.userId === user) {
        try {
          const current = await vault.read(user, id);
          if (
            current &&
            ["available", "completed", "cancelled"].includes(current.state)
          ) {
            pendingRelease.delete(id);
            continue;
          }
          await vault.change(user, id, p.claimId, (row) => {
            row.state = "available";
            delete row.claim;
            finishRow(row);
          });
          pendingRelease.delete(id);
        } catch {
          /* Retain the durable claim until release succeeds. */
        }
      }
  }
  function compare(source, local) {
    if (
      !source ||
      source.stat.size !== local.spec.size ||
      source.sha256 !== local.spec.sha256 ||
      JSON.stringify(source.hashes) !== JSON.stringify(local.spec.hashes)
    )
      throw Error("DOWNLOAD_BATCH_SOURCE_MISMATCH");
  }
  function entryViews(row) {
    const entries = new Map(row.target.entries.map((e) => [e.id, e]));
    return row.target.entries.map((e) => {
      const names = [e.name];
      let p = e.parentId ? entries.get(e.parentId) : undefined;
      while (p) {
        names.unshift(p.name);
        p = p.parentId ? entries.get(p.parentId) : undefined;
      }
      return {
        id: e.id,
        parentId: e.parentId,
        name: e.name,
        kind: e.kind,
        size: e.size,
        status: e.status,
        relativePath: names.join("/"),
        path: path.join(row.target.path, ...names),
        action: e.action,
        result: e.result,
        error: e.error,
      };
    });
  }
  async function handle(scoped, operation, ticketId, args = {}) {
    const { value: scope, guard } = await recovery.scopeFor(scoped);
    if (!uuid.test(ticketId || ""))
      throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    const ticket = await rpc(scope, "claim", ticketId);
    if (ticket.kind !== operation) throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    guard();
    let keep = false;
    try {
      await retryRelease(ticket.userId);
      if (operation === "list") return await vault.list(ticket.userId);
      if (operation === "save") {
        if (
          !ticket.source ||
          !uuid.test(args.targetId || "") ||
          !Array.isArray(args.members) ||
          args.members.length > 4096
        )
          throw Error("DOWNLOAD_BATCH_INVALID");
        const linked = active.get(args.targetId),
          alias = aliases.get(args.targetId),
          recordId = linked?.id ?? alias?.id ?? ticket.source.tree.id;
        if (
          linked &&
          (linked.owner !== scoped.id || linked.userId !== ticket.userId)
        )
          throw Error("DOWNLOAD_BATCH_CONFLICT");
        const old = await vault.read(ticket.userId, recordId);
        if (old && !linked) {
          if (
            old.target.id !== args.targetId ||
            old.source.id !== ticket.source.tree.id
          )
            throw Error("DOWNLOAD_BATCH_CONFLICT");
          return vault.summary(old);
        }
        if (linked) {
          await Promise.allSettled([...linked.work]);
          valid(linked);
        }
        const root = directories.owned(scoped.id, args.targetId),
          byEntry = new Map(
            ticket.source.members.map((m) => [m.entryId, m.source]),
          ),
          inputs = new Map(),
          paused = [],
          unknown = [],
          previews = [];
        for (const m of args.members) {
          if (!m || typeof m.entryId !== "string" || inputs.has(m.entryId))
            throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
          const e = root.entries.get(m.entryId);
          if (!e || e.kind !== "file")
            throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
          inputs.set(m.entryId, m);
          if (m.localId) {
            if (e.child !== m.localId)
              throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
            const r = sink.owned(scoped.id, m.localId);
            if (r.view.state === "paused") paused.push(m.localId);
            else if (r.view.state === "unknown") unknown.push(m.localId);
            else if (r.view.state === "preview") previews.push(m.localId);
            else if (r.view.state !== "completed")
              throw Error("DOWNLOAD_NOT_READY");
          }
        }
        let stored;
        await sink.suspendBatch(scoped.id, paused, async (parts) => {
          guard();
          const held = new Set([...paused, ...unknown, ...previews]),
            target = await directories.checkpoint(
              scoped.id,
              args.targetId,
              guard,
              held,
            ),
            snapshots = new Map(parts.map((p) => [p.id, p.checkpoint]));
          for (const id of unknown)
            snapshots.set(id, sink.recoveryCheckpoint(scoped.id, id));
          const members = target.entries
            .filter((e) => e.kind === "file")
            .map((e) => {
              const i = inputs.get(e.id),
                previous = old?.members.find((m) => m.entryId === e.id),
                local = i?.localId ? snapshots.get(i.localId) : previous?.local,
                source = byEntry.get(e.id) ?? previous?.source;
              if (e.result?.state === "completed")
                return { entryId: e.id, state: "completed" };
              if (local) compare(source, local);
              const state =
                unknown.includes(i?.localId) ||
                ["unknown", "committing"].includes(previous?.state)
                  ? "unknown"
                  : e.action === "skip" || i?.cancelled
                    ? "cancelled"
                    : local
                      ? "paused"
                      : "pending";
              return { entryId: e.id, state, local, source };
            });
          stored = linked
            ? await update(linked, (row) => {
                row.source = ticket.source.tree;
                row.target = target;
                row.members = members;
              })
            : await vault.create(
                ticket.userId,
                recordId,
                ticket.source.tree,
                target,
                members,
              );
        });
        if (unknown.length || previews.length)
          await sink.preserveBatch(scoped.id, [...unknown, ...previews]);
        directories.releaseRecovery(scoped.id, args.targetId);
        if (linked) {
          unbind(linked);
          await rpc(linked.scope, "done", linked.ticketId).catch(() => {});
        }
        aliases.set(args.targetId, {
          id: stored.id,
          userId: ticket.userId,
          owner: scoped.id,
        });
        while (aliases.size > 256) aliases.delete(aliases.keys().next().value);
        pendingRelease.set(stored.id, {
          userId: ticket.userId,
          claimId: stored.claim.id,
        });
        await retryRelease(ticket.userId);
        return vault.summary(await vault.read(ticket.userId, stored.id));
      }
      if (!uuid.test(args.id || "")) throw Error("DOWNLOAD_BATCH_INVALID");
      if (operation === "detail") {
        const row = await vault.read(ticket.userId, args.id);
        if (!row) throw Error("DOWNLOAD_BATCH_NOT_FOUND");
        return {
          summary: vault.summary(row),
          entries: entryViews(row),
          members: row.members.map((m) => ({
            entryId: m.entryId,
            state: m.state,
          })),
        };
      }
      if (operation === "restore") {
        if (
          !args.reviewed ||
          typeof args.overwrite !== "boolean" ||
          !uuid.test(args.targetId || "")
        )
          throw Error("DOWNLOAD_BATCH_REVIEW_REQUIRED");
        const row = await vault.claim(ticket.userId, args.id);
        let targetId;
        const localIds = [];
        try {
          if (vault.summary(row).existing && !args.overwrite)
            throw Error("DOWNLOAD_OVERWRITE_REQUIRED");
          const source = await rpc(scope, "restoreTree", ticketId, {
            source: row.source,
          });
          guard();
          let target = await directories.restore(
            scoped.id,
            args.targetId,
            row.target,
            guard,
          );
          targetId = target.id;
          const old = new Map(row.target.entries.map((e) => [e.id, e]));
          target = directories.confirm(
            scoped.id,
            target.id,
            target.revision,
            target.entries.map((e) => ({
              id: e.id,
              action:
                e.result?.state === "completed" ||
                old.get(e.id)?.action === "skip" ||
                row.members.find((m) => m.entryId === e.id)?.state ===
                  "cancelled"
                  ? "skip"
                  : e.status === "directory"
                    ? "merge"
                    : e.status === "conflict"
                      ? "overwrite"
                      : "create",
            })),
            guard,
          );
          const b = {
              owner: scoped.id,
              userId: ticket.userId,
              id: row.id,
              claimId: row.claim.id,
              scope,
              guard,
              ticketId,
              targetId,
              sourceId: source.id,
              files: new Map(),
              work: new Set(),
              stopping: false,
            },
            members = [];
          for (const m of row.members) {
            guard();
            if (m.state === "paused" && m.local) {
              const remote = await rpc(scope, "restoreSource", ticketId, {
                entryId: m.entryId,
                source: m.source,
              });
              guard();
              const local = await sink.restore(scoped.id, m.local, {
                authorize: guard,
                overwrite: args.overwrite,
                source: remote,
              });
              localIds.push(local.id);
              await directories.attachRestored(
                scoped.id,
                targetId,
                m.entryId,
                local.id,
                guard,
              );
              b.files.set(local.id, {
                entryId: m.entryId,
                source: m.source,
                sourceId: remote.id,
                busy: false,
              });
              members.push({
                entryId: m.entryId,
                state: "paused",
                source: remote,
                local,
              });
            } else if (m.state === "completed") {
              const e = row.target.entries.find((e) => e.id === m.entryId),
                targetEntry = target.entries.find((e) => e.id === m.entryId);
              members.push({
                entryId: m.entryId,
                state: "completed",
                local: {
                  id: m.entryId,
                  path: targetEntry.path,
                  size: e.size,
                  writtenBytes: e.size,
                  state: "completed",
                  sha256: e.receipt.sha256,
                },
              });
            } else
              members.push({
                entryId: m.entryId,
                state: m.state === "committing" ? "unknown" : m.state,
              });
          }
          bind(b);
          keep = true;
          return { summary: vault.summary(row), source, target, members };
        } catch (error) {
          if (localIds.length)
            await sink.preserveBatch(scoped.id, localIds).catch(() => {});
          if (targetId) directories.releaseRecovery(scoped.id, targetId);
          await vault
            .release(ticket.userId, row.id, row.claim.id)
            .catch(() => {});
          throw error;
        }
      }
      if (operation === "check") {
        const live = [...active.values()].find(
          (b) => b.userId === ticket.userId && b.id === args.id,
        );
        if (live) {
          if (live.owner !== scoped.id) throw Error("DOWNLOAD_BATCH_CONFLICT");
          await Promise.allSettled([...live.work]);
        }
        const row = live
          ? await vault.read(ticket.userId, args.id)
          : await vault.claim(ticket.userId, args.id);
        if (!row) throw Error("DOWNLOAD_BATCH_NOT_FOUND");
        try {
          const completed = [];
          const target = await directories.reconcileSavedDirectories(
            row.target,
            guard,
          );
          await vault.change(
            ticket.userId,
            row.id,
            live?.claimId ?? row.claim.id,
            (r) => {
              r.target = target;
              finishRow(r);
            },
          );
          if (live) {
            const root = directories.owned(scoped.id, live.targetId);
            for (const e of target.entries) {
              const current = root.entries.get(e.id);
              if (current && e.kind === "directory") {
                current.directoryIdentity = e.directoryIdentity;
                current.result = e.result;
                current.status = e.status;
              }
            }
          }
          for (const m of row.members)
            if (["committing", "unknown"].includes(m.state) && m.local) {
              guard();
              const result = await sink.reconcile(m.local, guard);
              const receipt = await directories.receiptFromCheckpoint(
                row.target,
                m.entryId,
                m.local,
                guard,
              );
              await vault.change(
                ticket.userId,
                row.id,
                live?.claimId ?? row.claim.id,
                (r) => {
                  const e = r.target.entries.find((e) => e.id === m.entryId);
                  e.result = { state: "completed" };
                  e.receipt = receipt;
                  const item = member(r, m.entryId);
                  item.state = "completed";
                  delete item.local;
                  delete item.source;
                  finishRow(r);
                },
              );
              completed.push({
                entryId: m.entryId,
                local: {
                  id: m.local.id,
                  path: m.local.destination,
                  size: m.local.spec.size,
                  writtenBytes: m.local.spec.size,
                  state: "completed",
                  sha256: result.sha256,
                },
              });
              if (live) {
                for (const [localId, binding] of live.files)
                  if (binding.entryId === m.entryId) {
                    await sink.preserveRecovered(scoped.id, localId);
                    live.files.delete(localId);
                    files.delete(localId);
                  }
                const root = directories.owned(scoped.id, live.targetId),
                  e = root.entries.get(m.entryId);
                e.result = { state: "completed" };
                e.sha256 = result.sha256;
                e.completed = {
                  id: m.local.id,
                  path: m.local.destination,
                  size: m.local.spec.size,
                  writtenBytes: m.local.spec.size,
                  state: "completed",
                  sha256: result.sha256,
                };
              }
            }
          return {
            summary: vault.summary(await vault.read(ticket.userId, args.id)),
            completed,
          };
        } finally {
          if (!live) {
            const current = await vault.read(ticket.userId, args.id);
            if (current?.state === "claimed")
              await vault.release(ticket.userId, args.id, row.claim.id);
          }
        }
      }
      if (operation === "discard") {
        const row = await vault.claim(ticket.userId, args.id);
        try {
          if (vault.summary(row).unknown)
            throw Error("DOWNLOAD_BATCH_RECONCILE_REQUIRED");
          for (const m of row.members)
            if (m.local) await sink.discardCheckpoint(m.local, guard);
          const updated = await vault.change(
            ticket.userId,
            args.id,
            row.claim.id,
            (r) => {
              for (const m of r.members) {
                if (m.state !== "completed") m.state = "cancelled";
                delete m.local;
                delete m.source;
              }
              r.state = "cancelled";
              delete r.claim;
            },
          );
          return vault.summary(updated);
        } catch (error) {
          await vault
            .release(ticket.userId, args.id, row.claim.id)
            .catch(() => {});
          throw error;
        }
      }
      if (operation === "remove") {
        await vault.remove(ticket.userId, args.id);
        const b = [...active.values()].find(
          (b) =>
            b.owner === scoped.id &&
            b.userId === ticket.userId &&
            b.id === args.id,
        );
        if (b) {
          unbind(b);
          await rpc(b.scope, "done", b.ticketId).catch(() => {});
        }
        return { removed: true };
      }
      throw Error("DOWNLOAD_BATCH_INVALID");
    } finally {
      if (!keep) await rpc(scope, "done", ticketId).catch(() => {});
    }
  }
  async function beforeFile(owner, targetId, entryId, sourceId, spec) {
    const b = active.get(targetId);
    if (!b) return null;
    assertTree(owner, targetId);
    return track(b, async () => {
      if (!uuid.test(sourceId || ""))
        throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
      const source = await rpc(b.scope, "proof", b.ticketId, {
        entryId,
        sourceId,
      });
      valid(b);
      if (
        source.stat.size !== spec.size ||
        source.sha256 !== spec.sha256 ||
        JSON.stringify(source.hashes) !== JSON.stringify(spec.hashes)
      )
        throw Error("DOWNLOAD_BATCH_SOURCE_MISMATCH");
      return { b, entryId, sourceId, source };
    });
  }
  function afterFile(owner, id, proof) {
    if (!proof) return;
    valid(proof.b);
    const item = {
      entryId: proof.entryId,
      sourceId: proof.sourceId,
      source: proof.source,
      busy: false,
    };
    proof.b.files.set(id, item);
    files.set(id, { b: proof.b, m: item });
  }
  async function afterStart(owner, id, result) {
    const item = files.get(id);
    if (!item) return;
    assertFile(owner, id, "start");
    if (result.state !== "writing") return;
    await track(item.b, async () => {
      const local = sink.recoveryCheckpoint(owner, id);
      compare(item.m.source, local);
      await update(item.b, (row) => {
        Object.assign(member(row, item.m.entryId), {
          state: "paused",
          source: item.m.source,
          local,
        });
      });
      sink.owned(owner, id).recoveryCheckpoint = local;
    });
  }
  async function beforeFinish(owner, id) {
    const item = files.get(id);
    if (!item) return;
    assertFile(owner, id, "finish");
    item.m.busy = true;
    try {
      await track(item.b, async () => {
        const source = await rpc(item.b.scope, "proof", item.b.ticketId, {
          entryId: item.m.entryId,
          sourceId: item.m.sourceId,
          verified: true,
        });
        valid(item.b);
        const local = sink.recoveryCheckpoint(owner, id);
        compare(source, local);
        await update(item.b, (row) => {
          Object.assign(member(row, item.m.entryId), {
            state: "committing",
            source,
            local,
          });
        });
      });
    } catch (error) {
      item.m.busy = false;
      throw error;
    }
  }
  async function afterFinish(owner, id, result) {
    const item = files.get(id);
    if (!item) return;
    const { b, m } = item;
    try {
      if (result.state === "completed") {
        directories.complete(owner, b.targetId, m.entryId);
        const receipt = await directories.completionReceipt(
          owner,
          b.targetId,
          m.entryId,
        );
        await update(b, (row) => {
          const e = row.target.entries.find((e) => e.id === m.entryId);
          e.result = { state: "completed" };
          e.receipt = receipt.receipt;
          const current = member(row, m.entryId);
          current.state = "completed";
          delete current.local;
          delete current.source;
          finishRow(row);
        });
        b.files.delete(id);
        files.delete(id);
      } else
        await update(b, (row) => {
          member(row, m.entryId).state = "unknown";
        });
    } finally {
      m.busy = false;
    }
  }
  async function finishFailed(owner, id) {
    const item = files.get(id);
    if (!item) return;
    item.m.busy = false;
    await update(item.b, (row) => {
      member(row, item.m.entryId).state = "unknown";
    }).catch(() => {});
  }
  async function beforeDirectories(owner, id) {
    const b = active.get(id);
    if (!b) return;
    assertTree(owner, id);
    await update(b, (row) => {
      for (const e of row.target.entries)
        if (
          e.kind === "directory" &&
          e.action !== "skip" &&
          !["created", "merged", "unknown"].includes(e.result?.state)
        )
          e.result = { state: "unknown" };
    });
  }
  async function afterDirectories(owner, id) {
    const b = active.get(id);
    if (!b) return;
    assertTree(owner, id);
    const target = await directories.checkpoint(
      owner,
      id,
      () => valid(b),
      new Set(b.files.keys()),
    );
    await update(b, (row) => {
      row.target = target;
      finishRow(row);
    });
  }
  async function afterCancel(owner, id, result) {
    const item = files.get(id);
    if (!item) return;
    if (result.state === "completed") return afterFinish(owner, id, result);
    if (result.state !== "cancelled") return;
    await update(item.b, (row) => {
      const m = member(row, item.m.entryId);
      if (!["unknown", "committing"].includes(m.state)) {
        m.state = "cancelled";
        if (!result.temporaryPath) {
          delete m.local;
          delete m.source;
        }
      }
      finishRow(row);
    });
    item.b.files.delete(id);
    files.delete(id);
  }
  async function afterCancelTree(owner, id, result) {
    const b = active.get(id);
    if (!b) return;
    assertTree(owner, id);
    await Promise.allSettled([...b.work]);
    const cancelled = new Set();
    for (const [localId, m] of b.files) {
      try {
        const v = sink.view(sink.owned(owner, localId));
        if (v.state === "cancelled" && !v.temporaryPath)
          cancelled.add(m.entryId);
      } catch (error) {
        if (error.message !== "DOWNLOAD_NOT_FOUND") throw error;
      }
    }
    const updated = await update(b, (row) => {
      for (const m of row.members) {
        if (m.state === "pending" || cancelled.has(m.entryId)) {
          m.state = "cancelled";
          delete m.local;
          delete m.source;
        }
      }
      for (const e of row.target.entries) {
        const final = result.entries.find((v) => v.id === e.id);
        if (
          e.kind === "directory" &&
          !["created", "merged", "unknown"].includes(final?.result?.state)
        ) {
          e.action = "skip";
          e.result = { state: "skipped" };
        }
      }
      if (
        row.members.every(
          (m) => ["completed", "cancelled"].includes(m.state) && !m.local,
        ) &&
        !row.target.entries.some((e) => e.result?.state === "unknown")
      ) {
        row.state = "cancelled";
        delete row.claim;
      }
    });
    if (updated.state === "cancelled") {
      unbind(b);
      await rpc(b.scope, "done", b.ticketId).catch(() => {});
    }
  }
  async function afterForgetTree(owner, id) {
    const b = active.get(id);
    if (!b) return;
    const row = await vault.read(b.userId, b.id);
    if (row && !["completed", "cancelled"].includes(row.state))
      throw Error("DOWNLOAD_NOT_READY");
    unbind(b);
    await rpc(b.scope, "done", b.ticketId).catch(() => {});
  }
  async function reset(owner) {
    for (const b of [...active.values()])
      if (b.owner === owner) {
        b.stopping = true;
        await Promise.allSettled([...b.work]);
        try {
          const ids = [...b.files.keys()].filter((id) => {
              try {
                sink.owned(owner, id);
                return true;
              } catch {
                return false;
              }
            }),
            parts = await sink.preserveBatch(owner, ids),
            row = await vault.read(b.userId, b.id);
          if (row && ["claimed", "preparing"].includes(row.state))
            await update(b, (r) => {
              for (const p of parts) {
                const f = b.files.get(p.id),
                  m = member(r, f.entryId);
                if (
                  p.checkpoint &&
                  !["unknown", "committing"].includes(m.state)
                ) {
                  m.local = p.checkpoint;
                  m.source = f.source;
                  m.state = "paused";
                }
              }
              r.state = "available";
              delete r.claim;
            });
          directories.releaseRecovery(owner, b.targetId);
          unbind(b);
          await rpc(b.scope, "done", b.ticketId).catch(() => {});
        } catch {
          /* Retain ownership when durable cleanup cannot finish. */
        }
      }
    for (const [id, a] of aliases) if (a.owner === owner) aliases.delete(id);
  }
  return {
    handle,
    reset,
    assertFile,
    assertTree,
    beforeFile,
    afterFile,
    afterStart,
    beforeFinish,
    afterFinish,
    finishFailed,
    beforeDirectories,
    afterDirectories,
    afterCancel,
    afterCancelTree,
    afterForgetTree,
    vault,
  };
}
module.exports = { createDownloadBatchRecovery };
