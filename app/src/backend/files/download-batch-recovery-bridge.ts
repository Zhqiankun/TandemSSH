import { z } from "zod";
import type { LocalBridgeTransport } from "./local-file-bridge.js";
import type { DownloadBatchRecoveryTickets } from "./download-batch-recovery-tickets.js";
const id = z.string().uuid(),
  base = {
    type: z.literal("tandem-download-batch-recovery-request"),
    requestId: id,
    windowToken: id,
    ticketId: id,
  };
const schema = z.discriminatedUnion("method", [
  z.object({ ...base, method: z.literal("claim") }).strict(),
  z
    .object({ ...base, method: z.literal("restoreTree"), source: z.unknown() })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal("restoreSource"),
      entryId: id,
      source: z.unknown(),
    })
    .strict(),
  z
    .object({ ...base, method: z.literal("proof"), entryId: id, sourceId: id })
    .strict(),
  z.object({ ...base, method: z.literal("snapshot") }).strict(),
  z
    .object({
      ...base,
      method: z.literal("done"),
      releaseSaved: z.boolean().optional(),
    })
    .strict(),
]);
export function registerDownloadBatchRecoveryBridge(
  service: DownloadBatchRecoveryTickets,
  transport: LocalBridgeTransport,
) {
  let pending = 0,
    closed = false;
  const listener = (raw?: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { type?: string }).type !==
        "tandem-download-batch-recovery-request"
    )
      return;
    const p = schema.safeParse(raw);
    if (!p.success) return;
    const send = (value: object) => {
      if (!closed)
        try {
          transport.send(
            {
              type: "tandem-download-batch-recovery-response",
              requestId: p.data.requestId,
              ...value,
            },
            () => {},
          );
        } catch {
          /* Teardown keeps already released sources closed. */
        }
    };
    if (pending >= 8) {
      send({ ok: false, error: "DOWNLOAD_BATCH_BUSY" });
      return;
    }
    pending++;
    void Promise.resolve()
      .then(async () => {
        if (Buffer.byteLength(JSON.stringify(raw)) > 16 * 1024 * 1024)
          throw Error("DOWNLOAD_BATCH_LIMIT");
        const r = p.data;
        switch (r.method) {
          case "claim":
            return service.claim(r.windowToken, r.ticketId);
          case "restoreTree":
            return service.restoreTree(r.windowToken, r.ticketId, r.source);
          case "restoreSource":
            return service.restoreSource(
              r.windowToken,
              r.ticketId,
              r.entryId,
              r.source,
            );
          case "proof":
            return service.proof(
              r.windowToken,
              r.ticketId,
              r.entryId,
              r.sourceId,
            );
          case "snapshot":
            return service.snapshot(r.windowToken, r.ticketId);
          case "done":
            return service.done(r.windowToken, r.ticketId, r.releaseSaved);
        }
      })
      .then(
        (value) => send({ ok: true, value }),
        (e) =>
          send({
            ok: false,
            error:
              e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
                ? e.message
                : "DOWNLOAD_BATCH_FAILED",
          }),
      )
      .finally(() => pending--);
  };
  const close = () => {
    closed = true;
    service.dispose();
    transport.removeListener("message", listener);
    transport.removeListener("disconnect", close);
  };
  transport.on("message", listener);
  transport.on("disconnect", close);
  return close;
}
