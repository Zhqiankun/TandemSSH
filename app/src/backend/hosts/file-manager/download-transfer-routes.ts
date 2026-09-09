import type { DownloadBatchRecoveryTickets } from "../../files/download-batch-recovery-tickets.js";
import type { DownloadRecoveryTickets } from "../../files/download-recovery-tickets.js";
import type { Express, Request, Response } from "express";
import {
  scanDownloadTreeSchema,
  type DownloadTreeService,
} from "../../files/download-tree-service.js";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  prepareDownloadSchema,
  type DownloadActor,
  type DownloadService,
} from "../../files/download-service.js";
export function registerDownloadTransferRoutes(
  app: Express,
  service: DownloadService,
  trees?: DownloadTreeService,
  recovery?: DownloadRecoveryTickets,
  batches?: DownloadBatchRecoveryTickets,
) {
  const prefix = "/ssh/file_manager/ssh/downloads",
    uuid = z.string().uuid();
  function route(
    work: (actor: DownloadActor, req: Request) => unknown | Promise<unknown>,
  ) {
    return (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const user = req as AuthenticatedRequest;
      if (!user.userId || user.apiKeyId) {
        res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
        return;
      }
      const stop = new AbortController(),
        abort = () => stop.abort(),
        close = () => {
          if (!res.writableEnded) abort();
        };
      req.once("aborted", abort);
      res.once("close", close);
      Promise.resolve()
        .then(() => work({ userId: user.userId, signal: stop.signal }, req))
        .then((value) => {
          if (res.destroyed) return;
          if (Buffer.isBuffer(value))
            res.type("application/octet-stream").send(value);
          else res.json(value);
        })
        .catch((error) => {
          const code =
            error instanceof z.ZodError
              ? "DOWNLOAD_REQUEST_INVALID"
              : error instanceof Error &&
                  /^[A-Z][A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "DOWNLOAD_FAILED";
          if (!res.destroyed)
            res
              .status(code === "DOWNLOAD_NOT_FOUND" ? 404 : 409)
              .json({ error: code });
        })
        .finally(() => {
          req.removeListener("aborted", abort);
          res.removeListener("close", close);
        });
    };
  }
  if (recovery)
    app.post(
      prefix + "/recovery/ticket",
      route((actor, req) => recovery.issue(actor.userId, req.body)),
    );
  if (batches)
    app.post(
      prefix + "/batches/recovery/ticket",
      route((actor, req) => batches.issue(actor.userId, req.body)),
    );
  if (trees) {
    app.post(
      prefix + "/trees/:treeId/touch",
      route((actor, req) => trees.touch(actor, uuid.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/scan",
      route((actor, req) =>
        trees.scan(actor, scanDownloadTreeSchema.parse(req.body)),
      ),
    );
    app.get(
      prefix + "/trees/:treeId",
      route((actor, req) => trees.get(actor, uuid.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/:treeId/forget",
      route((actor, req) => trees.forget(actor, uuid.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/:treeId/entries/:entryId/prepare",
      route((actor, req) => {
        const input = z
          .object({ requestId: uuid, sessionId: z.string().min(1).max(256) })
          .strict()
          .parse(req.body);
        return trees.prepareEntry(
          actor,
          uuid.parse(req.params.treeId),
          uuid.parse(req.params.entryId),
          input.requestId,
          input.sessionId,
        );
      }),
    );
  }
  app.post(
    prefix + "/prepare",
    route((actor, req) =>
      service.prepare(actor, prepareDownloadSchema.parse(req.body)),
    ),
  );
  app.get(
    prefix + "/:id",
    route((actor, req) => service.get(actor, uuid.parse(req.params.id))),
  );
  app.get(
    prefix + "/:id/chunk",
    route((actor, req) => {
      const q = z
        .object({ offset: z.coerce.number().int().nonnegative() })
        .strict()
        .parse(req.query);
      return service.chunk(actor, uuid.parse(req.params.id), q.offset);
    }),
  );
  app.post(
    prefix + "/:id/touch",
    route((actor, req) => service.touch(actor, uuid.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/pause",
    route((actor, req) => service.pause(actor, uuid.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/resume",
    route((actor, req) =>
      service.verify(
        actor,
        uuid.parse(req.params.id),
        z
          .object({ sessionId: z.string().min(1).max(256) })
          .strict()
          .parse(req.body).sessionId,
      ),
    ),
  );
  app.post(
    prefix + "/:id/verify",
    route((actor, req) => service.verify(actor, uuid.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/forget",
    route((actor, req) => service.forget(actor, uuid.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/cancel",
    route((actor, req) => service.cancel(actor, uuid.parse(req.params.id))),
  );
}
