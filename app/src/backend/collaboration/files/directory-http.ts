import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { DirectoryAutomation } from "./directories.js";
import {
  directoryPreviewSchema,
  directoryPageSchema,
  directoryRunSchema,
} from "../../files/directory-transfer-schema.js";
const id = z.string().uuid(),
  requestId = z.string().min(1).max(128);
export function directoryTaskRoutes(service: DirectoryAutomation) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const user = req as AuthenticatedRequest;
    if (!user.userId || user.apiKeyId) {
      res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
      return;
    }
    next();
  });
  const route =
    (
      fn: (
        actor: { kind: "human"; userId: string },
        task: string,
        req: express.Request,
      ) => unknown | Promise<unknown>,
    ): express.RequestHandler =>
    (req, res) => {
      Promise.resolve()
        .then(() =>
          fn(
            { kind: "human", userId: (req as AuthenticatedRequest).userId! },
            id.parse(req.params.taskId),
            req,
          ),
        )
        .then((value) => {
          if (!res.destroyed) res.json(value);
        })
        .catch((error) => {
          const code =
            error instanceof z.ZodError
              ? "INVALID_REQUEST"
              : error instanceof Error &&
                  /^[A-Z][A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "DIRECTORY_TRANSFER_FAILED";
          if (!res.destroyed)
            res
              .status(code.endsWith("NOT_FOUND") ? 404 : 409)
              .json({ error: code });
        });
    };
  router.get(
    "/tasks/:taskId",
    route((a, t) => ({
      previews: service.previews(a, t),
      runs: service.list(a, t),
    })),
  );
  router.post(
    "/tasks/:taskId/previews",
    route((a, t, req) => {
      const { requestId: request, ...input } = directoryPreviewSchema
        .extend({ requestId })
        .parse(req.body);
      return service.preview(
        a,
        t,
        { type: "file.directory.preview", ...input },
        request,
      );
    }),
  );
  router.get(
    "/tasks/:taskId/previews/:previewId",
    route((a, t, req) => {
      const p = directoryPageSchema.parse({
        previewId: req.params.previewId,
        offset: req.query.offset === undefined ? 0 : Number(req.query.offset),
      });
      return service.page(a, t, p.previewId, p.offset);
    }),
  );
  router.post(
    "/tasks/:taskId/runs",
    route((a, t, req) => {
      const p = directoryRunSchema.extend({ requestId }).parse(req.body);
      return service.run(a, t, p.previewId, p.revision, p.choices, p.requestId);
    }),
  );
  router.post(
    "/tasks/:taskId/previews/:previewId/release",
    route((a, t, req) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      return service.release(a, t, id.parse(req.params.previewId));
    }),
  );
  return router;
}
