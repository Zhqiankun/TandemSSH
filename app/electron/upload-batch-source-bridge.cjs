const { z } = require("zod");
const id = z.string().uuid(),
  base = {
    type: z.literal("tandem-upload-batch-source-request"),
    requestId: id,
    windowToken: id,
    sourceId: id,
  };
const schema = z.discriminatedUnion("method", [
  z.object({ ...base, method: z.literal("snapshot") }).strict(),
  z
    .object({
      ...base,
      method: z.literal("restore"),
      snapshot: z
        .string()
        .min(1)
        .max(12 * 1024 * 1024),
    })
    .strict(),
  z.object({ ...base, method: z.literal("forget") }).strict(),
]);
function createUploadBatchSourceBridge(sources, ownerFor) {
  const connections = new Map();
  function attach(backend) {
    if (!backend?.connected || connections.has(backend)) return;
    let closed = false,
      pending = 0;
    const reply = (requestId, value) => {
      if (!closed && backend.connected)
        try {
          backend.send(
            {
              type: "tandem-upload-batch-source-response",
              requestId,
              ...value,
            },
            () => {},
          );
        } catch {}
    };
    const message = (raw) => {
      if (raw?.type !== "tandem-upload-batch-source-request") return;
      const p = schema.safeParse(raw);
      if (!p.success) return;
      if (pending >= 4) {
        reply(p.data.requestId, { ok: false, error: "UPLOAD_BATCH_BUSY" });
        return;
      }
      pending++;
      void (async () => {
        const actor = await ownerFor(backend, p.data.windowToken);
        if (closed) throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
        const guard = () => {
          if (closed) throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
        };
        if (p.data.method === "snapshot")
          return {
            snapshot: JSON.stringify(
              sources.checkpoint(actor, p.data.sourceId, guard),
            ),
            selection: sources.view(sources.owned(actor, p.data.sourceId)),
          };
        if (p.data.method === "restore")
          return sources.restore(
            actor,
            p.data.sourceId,
            JSON.parse(p.data.snapshot),
            guard,
          );
        sources.forget(actor, p.data.sourceId);
        return null;
      })()
        .then(
          (value) => reply(p.data.requestId, { ok: true, value }),
          (error) =>
            reply(p.data.requestId, {
              ok: false,
              error:
                error instanceof Error &&
                /^[A-Z][A-Z0-9_]+$/.test(error.message)
                  ? error.message
                  : "UPLOAD_BATCH_SOURCE_FAILED",
            }),
        )
        .finally(() => pending--);
    };
    const close = () => {
      closed = true;
      backend.removeListener("message", message);
      backend.removeListener("disconnect", close);
      backend.removeListener("exit", close);
      connections.delete(backend);
    };
    backend.on("message", message);
    backend.once("disconnect", close);
    backend.once("exit", close);
    connections.set(backend, close);
  }
  return {
    attach,
    dispose: () => {
      for (const close of [...connections.values()]) close();
    },
  };
}
module.exports = { createUploadBatchSourceBridge };
