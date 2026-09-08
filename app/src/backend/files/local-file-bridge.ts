import { z } from "zod";
import type { LocalFileGrants } from "./local-file-grants.js";
const id = z.string().uuid(),
  base = {
    type: z.literal("tandem-local-files-request"),
    requestId: id,
    windowToken: id,
  };
const schema = z.discriminatedUnion("method", [
  z.object({ ...base, method: z.literal("bind") }).strict(),
  z.object({ ...base, method: z.literal("close") }).strict(),
  z.object({ ...base, method: z.literal("claim"), ticketId: id }).strict(),
  z.object({ ...base, method: z.literal("cancel"), ticketId: id }).strict(),
  z
    .object({
      ...base,
      method: z.literal("fulfill"),
      ticketId: id,
      paths: z.array(z.string().min(1).max(4096)).min(1).max(32),
    })
    .strict(),
]);
export interface LocalBridgeTransport {
  on(
    event: "message" | "disconnect",
    listener: (message?: unknown) => void,
  ): unknown;
  removeListener(
    event: "message" | "disconnect",
    listener: (message?: unknown) => void,
  ): unknown;
  send(message: unknown, callback: (error: Error | null) => void): unknown;
}
export function registerLocalFileBridge(
  service: LocalFileGrants,
  transport: LocalBridgeTransport,
) {
  let pending = 0,
    closed = false;
  const send = (requestId: string, result: object) => {
    if (!closed)
      try {
        transport.send(
          { type: "tandem-local-files-response", requestId, ...result },
          () => {},
        );
      } catch {
        /* Parent teardown revokes all window capabilities. */
      }
  };
  const message = (raw?: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { type?: string }).type !== "tandem-local-files-request"
    )
      return;
    const requestId = (raw as { requestId?: string }).requestId;
    if (!id.safeParse(requestId).success) return;
    if (
      closed ||
      (pending >= 8 &&
        !["close", "cancel"].includes((raw as { method: string }).method))
    ) {
      send(requestId!, { ok: false, error: "FILE_LOCAL_GRANT_BUSY" });
      return;
    }
    pending++;
    void (async () => {
      if (Buffer.byteLength(JSON.stringify(raw)) > 256 * 1024)
        throw Error("FILE_LOCAL_SELECTION_INVALID");
      const p = schema.parse(raw);
      switch (p.method) {
        case "bind":
          return service.bindWindow(p.windowToken);
        case "close":
          return service.closeWindow(p.windowToken);
        case "claim":
          return service.claim(p.windowToken, p.ticketId);
        case "cancel":
          return service.cancel(p.windowToken, p.ticketId);
        case "fulfill":
          return service.fulfill(p.windowToken, p.ticketId, p.paths);
      }
    })()
      .then(
        (value) => send(requestId!, { ok: true, value }),
        (error) =>
          send(requestId!, {
            ok: false,
            error:
              error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "FILE_LOCAL_REQUEST_FAILED",
          }),
      )
      .finally(() => pending--);
  };
  const disconnect = () => {
    closed = true;
    void service.dispose().catch(() => {});
  };
  transport.on("message", message);
  transport.on("disconnect", disconnect);
  return () => {
    transport.removeListener("message", message);
    transport.removeListener("disconnect", disconnect);
    disconnect();
  };
}
