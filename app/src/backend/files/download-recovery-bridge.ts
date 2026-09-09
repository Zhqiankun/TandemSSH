import { z } from "zod";
import type { LocalBridgeTransport } from "./local-file-bridge.js";
import type { DownloadRecoveryTickets } from "./download-recovery-tickets.js";
const id = z.string().uuid(),
  base = {
    type: z.literal("tandem-download-recovery-request"),
    requestId: id,
    windowToken: id,
  };
const schema = z.discriminatedUnion("method", [
  z
    .object({ ...base, method: z.literal("releaseSource"), sourceId: id })
    .strict(),
  z.object({ ...base, method: z.literal("bind") }).strict(),
  z.object({ ...base, method: z.literal("close") }).strict(),
  z.object({ ...base, method: z.literal("claim"), ticketId: id }).strict(),
  z
    .object({
      ...base,
      method: z.literal("restore"),
      ticketId: id,
      source: z.unknown(),
    })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal("done"),
      ticketId: id,
      keepSource: z.boolean(),
    })
    .strict(),
]);
export function registerDownloadRecoveryBridge(
  service: DownloadRecoveryTickets,
  transport: LocalBridgeTransport,
) {
  let closed = false,
    pending = 0;
  const message = (raw?: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { type?: string }).type !== "tandem-download-recovery-request"
    )
      return;
    const requestId = (raw as { requestId?: string }).requestId;
    if (!id.safeParse(requestId).success) return;
    const send = (result: object) => {
      if (!closed)
        transport.send(
          { type: "tandem-download-recovery-response", requestId, ...result },
          () => {},
        );
    };
    if (pending >= 8) {
      send({ ok: false, error: "DOWNLOAD_RECOVERY_BUSY" });
      return;
    }
    pending++;
    void (async () => {
      if (Buffer.byteLength(JSON.stringify(raw)) > 4 * 1024 * 1024)
        throw Error("DOWNLOAD_RECOVERY_INVALID");
      const p = schema.parse(raw);
      switch (p.method) {
        case "releaseSource":
          return service.releaseSource(p.windowToken, p.sourceId);
        case "bind":
          return service.bind(p.windowToken);
        case "close":
          return service.close(p.windowToken);
        case "claim":
          return service.claim(p.windowToken, p.ticketId);
        case "restore":
          return service.restore(p.windowToken, p.ticketId, p.source);
        case "done":
          return service.done(p.windowToken, p.ticketId, p.keepSource);
      }
    })()
      .then(
        (value) => send({ ok: true, value }),
        (e) =>
          send({
            ok: false,
            error:
              e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
                ? e.message
                : "DOWNLOAD_RECOVERY_FAILED",
          }),
      )
      .finally(() => pending--);
  };
  const close = () => {
    closed = true;
    service.dispose();
    transport.removeListener("message", message);
    transport.removeListener("disconnect", close);
  };
  transport.on("message", message);
  transport.on("disconnect", close);
  return close;
}
