import { z } from "zod";
import type { LocalBridgeTransport } from "./local-file-bridge.js";
import type { UploadRecoveryCoordinator } from "./upload-recovery-coordinator.js";
const schema = z
  .object({
    type: z.literal("tandem-upload-recovery-request"),
    requestId: z.string().uuid(),
    windowToken: z.string().uuid(),
    method: z.enum(["bind", "close"]),
  })
  .strict();
export function registerUploadRecoveryBridge(
  service: UploadRecoveryCoordinator,
  transport: LocalBridgeTransport,
) {
  let closed = false,
    pending = 0;
  const message = (raw?: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { type?: string }).type !== "tandem-upload-recovery-request"
    )
      return;
    const p = schema.safeParse(raw);
    if (!p.success) return;
    const send = (value: object) => {
      if (!closed)
        transport.send(
          {
            type: "tandem-upload-recovery-response",
            requestId: p.data.requestId,
            ...value,
          },
          () => {},
        );
    };
    if (pending >= 16) {
      send({ ok: false, error: "UPLOAD_RECOVERY_BUSY" });
      return;
    }
    pending++;
    void Promise.resolve()
      .then(async () =>
        p.data.method === "bind"
          ? service.bind(p.data.windowToken)
          : service.close(p.data.windowToken),
      )
      .then(
        (value) => send({ ok: true, value }),
        (e) =>
          send({
            ok: false,
            error:
              e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
                ? e.message
                : "UPLOAD_RECOVERY_FAILED",
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
