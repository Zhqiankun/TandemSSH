import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/index.js";
import type { LocalFileGrants } from "./local-file-grants.js";
const id = z.string().uuid(),
  empty = z.object({}).strict();
export function localFileGrantRoutes(
  service: LocalFileGrants,
  owned: (user: string, task: string) => void,
) {
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
        user: string,
        task: string,
        req: express.Request,
      ) => unknown | Promise<unknown>,
    ): express.RequestHandler =>
    (req, res) => {
      Promise.resolve()
        .then(() => {
          const user = (req as AuthenticatedRequest).userId!,
            task = id.parse(req.params.taskId);
          owned(user, task);
          return fn(user, task, req);
        })
        .then((value) => {
          if (!res.destroyed) res.json(value);
        })
        .catch((error) => {
          const code =
            error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "FILE_LOCAL_REQUEST_INVALID";
          if (!res.destroyed)
            res
              .status(code.endsWith("NOT_FOUND") ? 404 : 409)
              .json({ error: code });
        });
    };
  router.get(
    "/tasks/:taskId",
    route((user, task) => ({
      available: service.available(),
      grants: service.humanList(user, task),
    })),
  );
  router.post(
    "/tasks/:taskId/tickets",
    route((user, task, req) => service.issue(user, task, req.body)),
  );
  router.post(
    "/tasks/:taskId/tickets/:ticketId/cancel",
    route((user, task, req) => {
      empty.parse(req.body ?? {});
      return service.cancelHuman(user, task, id.parse(req.params.ticketId));
    }),
  );
  router.post(
    "/tasks/:taskId/grants/:grantId/revoke",
    route((user, task, req) => {
      empty.parse(req.body ?? {});
      return service.revoke(user, task, id.parse(req.params.grantId));
    }),
  );
  router.post(
    "/tasks/:taskId/grants/:grantId/forget",
    route((user, task, req) => {
      empty.parse(req.body ?? {});
      return service.forget(user, task, id.parse(req.params.grantId));
    }),
  );
  return router;
}
