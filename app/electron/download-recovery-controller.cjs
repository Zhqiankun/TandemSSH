const { randomUUID } = require("node:crypto");
const { DownloadRecoveryVault } = require("./download-recovery-vault.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function createDownloadRecovery({ sink, getBackend, root, crypto }) {
  const vault = new DownloadRecoveryVault({ root, crypto }),
    scopes = new Map(),
    active = new Map(),
    saved = new Map();
  function rpc(scope, method, extra = {}) {
    const backend = scope.backend;
    if (!backend?.connected)
      return Promise.reject(Error("DOWNLOAD_DESKTOP_REQUIRED"));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        backend.removeListener("message", message);
        backend.removeListener("disconnect", exit);
        backend.removeListener("exit", exit);
        error ? reject(error) : resolve(value);
      };
      const message = (reply) => {
        if (
          reply?.type !== "tandem-download-recovery-response" ||
          reply.requestId !== requestId
        )
          return;
        reply.ok
          ? finish(null, reply.value)
          : finish(
              Error(
                typeof reply.error === "string" &&
                  /^[A-Z][A-Z0-9_]+$/.test(reply.error)
                  ? reply.error
                  : "DOWNLOAD_RECOVERY_FAILED",
              ),
            );
      };
      const exit = () => finish(Error("DOWNLOAD_DESKTOP_REQUIRED"));
      const timer = setTimeout(
        () => finish(Error("DOWNLOAD_RECOVERY_TIMEOUT")),
        method === "restore" ? 300000 : 15000,
      );
      backend.on("message", message);
      backend.once("disconnect", exit);
      backend.once("exit", exit);
      try {
        backend.send(
          {
            type: "tandem-download-recovery-request",
            requestId,
            windowToken: scope.token,
            method,
            ...extra,
          },
          (e) => {
            if (e) exit();
          },
        );
      } catch {
        exit();
      }
    });
  }
  async function reset(owner) {
    for (const [id, r] of active)
      if (r.owner === owner) {
        active.delete(id);
        try {
          await vault.transition(r.userId, r.id, r.claimId, "available");
        } catch {
          /* Committing records retain their uncertain state. */
        }
      }
    for (const [id, r] of saved) if (r.owner === owner) saved.delete(id);
    const scope = scopes.get(owner);
    scopes.delete(owner);
    if (scope) await rpc(scope, "close").catch(() => {});
  }
  async function scope(scoped) {
    const backend = getBackend();
    if (!backend?.connected) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    let value = scopes.get(scoped.id);
    if (
      value &&
      (value.backend !== backend || value.epoch !== scoped.life.epoch)
    ) {
      await reset(scoped.id);
      value = undefined;
    }
    if (!value) {
      value = { backend, epoch: scoped.life.epoch, token: randomUUID() };
      scopes.set(scoped.id, value);
      value.ready = rpc(value, "bind");
    }
    try {
      await value.ready;
    } catch (e) {
      if (scopes.get(scoped.id) === value) scopes.delete(scoped.id);
      throw e;
    }
    const guard = () => {
      if (
        scopes.get(scoped.id) !== value ||
        value.backend !== getBackend() ||
        value.epoch !== scoped.life.epoch
      )
        throw Error("DOWNLOAD_CANCELLED");
    };
    guard();
    return { value, guard };
  }
  async function handle(scoped, operation, ticketId, args = {}) {
    const { value, guard } = await scope(scoped);
    if (operation === "identity") return { windowToken: value.token };
    if (!uuid.test(ticketId || ""))
      throw Error("DOWNLOAD_RECOVERY_TICKET_INVALID");
    const ticket = await rpc(value, "claim", { ticketId });
    if (ticket.kind !== operation)
      throw Error("DOWNLOAD_RECOVERY_TICKET_INVALID");
    guard();
    let keepSource = false;
    try {
      if (operation === "list") return await vault.list(ticket.userId);
      if (operation === "save") {
        if (typeof args.localId !== "string")
          throw Error("DOWNLOAD_RECOVERY_INVALID");
        const alias = saved.get(args.localId),
          linked = active.get(args.localId);
        if (
          linked &&
          (linked.owner !== scoped.id || linked.userId !== ticket.userId)
        )
          throw Error("DOWNLOAD_RECOVERY_CONFLICT");
        const existing = await vault.read(
          ticket.userId,
          alias?.sourceId === ticket.source.id && alias.userId === ticket.userId
            ? alias.id
            : ticket.source.id,
        );
        if (existing) {
          if (existing.local.id !== args.localId)
            throw Error("DOWNLOAD_RECOVERY_CONFLICT");
          return vault.summary(existing);
        }
        let stored;
        await sink.suspend(scoped.id, args.localId, async (local) => {
          guard();
          if (
            local.spec.size !== ticket.source.stat.size ||
            local.spec.sha256 !== ticket.source.sha256 ||
            local.spec.hashes.some((h, i) => h !== ticket.source.hashes[i]) ||
            local.spec.hashes.length !== ticket.source.hashes.length
          )
            throw Error("DOWNLOAD_CHECKPOINT_SOURCE_MISMATCH");
          stored = linked
            ? await vault.refresh(
                ticket.userId,
                linked.id,
                linked.claimId,
                ticket.source,
                local,
              )
            : await vault.create(
                ticket.userId,
                ticket.source,
                local,
                ticket.hostLabel,
              );
        });
        active.delete(args.localId);
        saved.set(args.localId, {
          id: stored.id,
          userId: ticket.userId,
          owner: scoped.id,
          sourceId: ticket.source.id,
        });
        while (saved.size > 256) saved.delete(saved.keys().next().value);
        guard();
        return vault.summary(stored);
      }
      if (!uuid.test(args.id || "")) throw Error("DOWNLOAD_RECOVERY_INVALID");
      if (operation === "restore") {
        if (typeof args.overwrite !== "boolean")
          throw Error("DOWNLOAD_RECOVERY_INVALID");
        const record = await vault.claim(ticket.userId, args.id);
        let local;
        try {
          guard();
          const source = await rpc(value, "restore", {
            ticketId,
            source: record.source,
          });
          guard();
          local = await sink.restore(scoped.id, record.local, {
            overwrite: args.overwrite,
            source,
            authorize: guard,
          });
          guard();
          active.set(local.id, {
            owner: scoped.id,
            userId: ticket.userId,
            id: record.id,
            claimId: record.claim.id,
            scope: value,
            sourceId: source.id,
          });
          keepSource = true;
          return { source, local, summary: vault.summary(record) };
        } catch (e) {
          if (local) {
            await sink.preserveRecovered(scoped.id, local.id).catch(() => {});
            active.delete(local.id);
          }
          await vault
            .transition(ticket.userId, record.id, record.claim.id, "available")
            .catch(() => {});
          throw e;
        }
      }
      if (operation === "discard") {
        const record = await vault.claim(ticket.userId, args.id);
        try {
          await sink.discardCheckpoint(record.local, guard);
          const result = await vault.transition(
            ticket.userId,
            record.id,
            record.claim.id,
            "cancelled",
          );
          return vault.summary(result);
        } catch (e) {
          await vault
            .transition(ticket.userId, record.id, record.claim.id, "available")
            .catch(() => {});
          throw e;
        }
      }
      if (operation === "check") {
        const record = await vault.read(ticket.userId, args.id);
        if (!record || !["unknown", "committing"].includes(record.state))
          throw Error("DOWNLOAD_RECOVERY_RECONCILE_REQUIRED");
        vault.canReconcile(record);
        const current = [...active.entries()].find(
          ([, r]) => r.owner === scoped.id && r.id === record.id,
        );
        if (current) {
          const r = sink.owned(scoped.id, current[0]);
          if (r.pending || current[1].finishing)
            throw Error("DOWNLOAD_RECOVERY_BUSY");
        }
        const checked = await sink.reconcileCheckpoint(record.local, guard);
        guard();
        const updated = await vault.checked(ticket.userId, record.id);
        let local;
        if (current) {
          const r = sink.owned(scoped.id, current[0]);
          if (r.handle) {
            await r.handle.close();
            r.handle = undefined;
          }
          Object.assign(r.view, {
            state: "completed",
            sha256: checked.sha256,
            writtenBytes: checked.size,
            temporaryPath: undefined,
            error: undefined,
          });
          local = sink.view(r);
          active.delete(current[0]);
        }
        return { summary: vault.summary(updated), local };
      }
      if (operation === "remove") {
        await vault.remove(ticket.userId, args.id);
        return { removed: true };
      }
      throw Error("DOWNLOAD_RECOVERY_INVALID");
    } finally {
      await rpc(value, "done", { ticketId, keepSource }).catch(() => {});
      guard();
    }
  }
  async function beforeFinish(owner, id) {
    const r = active.get(id);
    if (r?.owner === owner) {
      r.finishing = true;
      try {
        await vault.transition(r.userId, r.id, r.claimId, "committing");
      } catch (e) {
        r.finishing = false;
        throw e;
      }
    }
  }
  function finishFailed(owner, id) {
    const r = active.get(id);
    if (r?.owner === owner) r.finishing = false;
  }
  async function afterFinish(owner, id, result) {
    finishFailed(owner, id);
    const r = active.get(id);
    if (r?.owner === owner) {
      await vault.transition(
        r.userId,
        r.id,
        r.claimId,
        result.state === "completed" ? "completed" : "unknown",
      );
      if (result.state === "completed") {
        active.delete(id);
        await rpc(r.scope, "releaseSource", { sourceId: r.sourceId }).catch(
          () => {},
        );
      }
    }
  }
  async function afterCancel(owner, id, result) {
    const r = active.get(id);
    if (r?.owner === owner && result.state === "cancelled") {
      await vault.transition(r.userId, r.id, r.claimId, "cancelled");
      active.delete(id);
      await rpc(r.scope, "releaseSource", { sourceId: r.sourceId }).catch(
        () => {},
      );
    }
  }
  return {
    scopeFor: scope,
    handle,
    reset,
    beforeFinish,
    finishFailed,
    afterFinish,
    afterCancel,
  };
}
module.exports = { createDownloadRecovery };
