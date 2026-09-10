import type { Request, RequestHandler } from "express";
import { once } from "node:events";
import { z } from "zod";
import { AUDIT_EXPORT_LIMITS } from "../../../types/task-history.js";
import type { AuditJournal } from "./journal.js";
export function historyExportHandler(
  journal: (request: Request) => Pick<AuditJournal, "exportHistory">,
): RequestHandler {
  return (req, res) => {
    const controller = new AbortController();
    const stop = () => controller.abort(Error("HISTORY_EXPORT_CANCELLED"));
    res.once("close", stop);
    const timeout = setTimeout(
      () => controller.abort(Error("HISTORY_EXPORT_TIMEOUT")),
      120000,
    );
    timeout.unref?.();
    void (async () => {
      const query = z
        .object({ taskId: z.string().min(1).max(128).optional() })
        .strict()
        .parse(req.body);
      let bytes = 0;
      for await (const frame of journal(req).exportHistory(
        query,
        controller.signal,
      )) {
        controller.signal.throwIfAborted();
        const line = JSON.stringify(frame) + "\n",
          size = Buffer.byteLength(line);
        bytes += size;
        if (
          size > AUDIT_EXPORT_LIMITS.lineBytes ||
          bytes > AUDIT_EXPORT_LIMITS.bytes
        )
          throw Error("HISTORY_EXPORT_LIMIT");
        if (!res.headersSent)
          res.set({
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="TandemSSH-history.jsonl"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
        if (!res.write(line))
          await once(res, "drain", { signal: controller.signal });
      }
      controller.signal.throwIfAborted();
      res.end();
    })()
      .catch((error) => {
        if (res.destroyed) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const code =
          error instanceof z.ZodError
            ? "HISTORY_EXPORT_REQUEST_INVALID"
            : /^HISTORY_EXPORT_[A-Z_]+$/.test(error?.message ?? "")
              ? error.message
              : "HISTORY_EXPORT_FAILED";
        res
          .status(
            code === "HISTORY_EXPORT_BUSY"
              ? 409
              : code === "HISTORY_EXPORT_LIMIT"
                ? 413
                : 400,
          )
          .json({ error: code });
      })
      .finally(() => {
        clearTimeout(timeout);
        res.removeListener("close", stop);
      });
  };
}
