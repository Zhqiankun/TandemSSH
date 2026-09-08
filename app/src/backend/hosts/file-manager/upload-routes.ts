import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  uploadTreeSchema,
  type UploadTreeService,
} from "../../files/upload-tree-service.js";
import { uploadManifestSchema } from "../../files/upload-service.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  prepareUploadSchema,
  type UploadService,
  type UploadActor,
} from "../../files/upload-service.js";
export function registerUploadRoutes(
  app: Express,
  uploads: UploadService,
  trees?: UploadTreeService,
) {
  const prefix = "/ssh/file_manager/ssh/uploads",
    id = z.string().uuid();
  function route(
    work: (actor: UploadActor, req: Request) => unknown | Promise<unknown>,
  ) {
    return (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const user = req as AuthenticatedRequest;
      if (!user.userId || user.apiKeyId) {
        req.resume();
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
          if (!res.destroyed) res.json(value);
        })
        .catch((error) => {
          const code =
            error instanceof z.ZodError
              ? "UPLOAD_REQUEST_INVALID"
              : error instanceof Error &&
                  /^[A-Z][A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "UPLOAD_FAILED";
          if (!res.destroyed)
            res
              .status(
                code === "UPLOAD_NOT_FOUND"
                  ? 404
                  : code === "TRUSTED_UI_REQUIRED"
                    ? 403
                    : 409,
              )
              .json({ error: code });
        })
        .finally(() => {
          req.removeListener("aborted", abort);
          res.removeListener("close", close);
        });
    };
  }
  if (trees) {
    app.post(
      prefix + "/trees/preview",
      route((actor, req) =>
        trees.preview(actor, uploadTreeSchema.parse(req.body)),
      ),
    );
    app.get(
      prefix + "/trees/:treeId",
      route((actor, req) => trees.get(actor, id.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/:treeId/touch",
      route((actor, req) => trees.touch(actor, id.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/:treeId/confirm",
      route((actor, req) => {
        const p = z
          .object({
            revision: id,
            decisions: z
              .array(
                z
                  .object({
                    id: z.string(),
                    action: z.enum(["create", "merge", "overwrite", "skip"]),
                  })
                  .strict(),
              )
              .max(4096),
          })
          .strict()
          .parse(req.body);
        return trees.confirm(
          actor,
          id.parse(req.params.treeId),
          p.revision,
          p.decisions,
        );
      }),
    );
    app.post(
      prefix + "/trees/:treeId/directories",
      route((actor, req) => {
        const p = z
          .object({ takeover: z.boolean().default(false) })
          .strict()
          .parse(req.body);
        return trees.directories(
          actor,
          id.parse(req.params.treeId),
          p.takeover,
        );
      }),
    );
    app.post(
      prefix + "/trees/:treeId/entries/:entryId/prepare",
      route((actor, req) => {
        const p = z
          .object({
            sessionId: z.string().min(1).max(256),
            requestId: z.string().min(1).max(128),
            manifest: uploadManifestSchema,
          })
          .strict()
          .parse(req.body);
        return trees.prepareEntry(
          actor,
          id.parse(req.params.treeId),
          z.string().min(1).max(128).parse(req.params.entryId),
          p.sessionId,
          p.requestId,
          p.manifest,
        );
      }),
    );
    app.post(
      prefix + "/trees/:treeId/cancel",
      route((actor, req) => trees.cancel(actor, id.parse(req.params.treeId))),
    );
    app.post(
      prefix + "/trees/:treeId/forget",
      route((actor, req) => trees.forget(actor, id.parse(req.params.treeId))),
    );
  }
  app.post(
    prefix + "/:id/touch",
    route((actor, req) => uploads.touch(actor, id.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/forget",
    route((actor, req) => uploads.forget(actor, id.parse(req.params.id))),
  );
  app.post(
    prefix + "/prepare",
    route((actor, req) =>
      uploads.prepare(actor, prepareUploadSchema.parse(req.body)),
    ),
  );
  app.get(
    prefix + "/:id",
    route((actor, req) => uploads.get(actor, id.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/start",
    route((actor, req) =>
      uploads.start(
        actor,
        id.parse(req.params.id),
        z
          .object({ overwrite: z.boolean(), takeover: z.boolean().optional() })
          .strict()
          .parse(req.body),
      ),
    ),
  );
  app.post(
    prefix + "/:id/chunk",
    route((actor, req) => {
      const q = z
        .object({ offset: z.coerce.number().int().nonnegative() })
        .strict()
        .parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw Error("UPLOAD_CHUNK_INVALID");
      return uploads.chunk(actor, id.parse(req.params.id), q.offset, req.body);
    }),
  );
  app.post(
    prefix + "/:id/pause",
    route((actor, req) => uploads.pause(actor, id.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/resume",
    route((actor, req) => {
      const p = z
        .object({
          sessionId: z.string().min(1).max(256),
          takeover: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      return uploads.resume(
        actor,
        id.parse(req.params.id),
        p.sessionId,
        p.takeover,
      );
    }),
  );
  app.post(
    prefix + "/:id/finish",
    route((actor, req) => uploads.finish(actor, id.parse(req.params.id))),
  );
  app.post(
    prefix + "/:id/cancel",
    route((actor, req) => {
      const p = z
        .object({ cleanup: z.boolean().default(false) })
        .strict()
        .parse(req.body ?? {});
      return uploads.cancel(actor, id.parse(req.params.id), p.cleanup);
    }),
  );
  for (const name of ["uploadFile", "uploadFileStream", "uploadFileChunk"])
    app.post("/ssh/file_manager/ssh/" + name, (req, res) => {
      req.resume();
      res.status(409).json({ error: "UPLOAD_PREVIEW_REQUIRED" });
    });
}
