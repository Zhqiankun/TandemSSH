import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { TaskRecoveryService } from "./service.js";
export function taskRecoveryRoutes(service: TaskRecoveryService) {
  const router = express.Router(),
    id = z.string().uuid(),
    actor = (req: express.Request) => ({
      kind: "human" as const,
      userId: (req as AuthenticatedRequest).userId!,
    });
  const route =
    (
      work: (req: express.Request) => Promise<unknown>,
    ): express.RequestHandler =>
    (req, res) => {
      void Promise.resolve()
        .then(() => work(req))
        .then(
          (v) => res.json(v),
          (e) =>
            res
              .status(400)
              .json({
                error:
                  e instanceof z.ZodError
                    ? "INVALID_REQUEST"
                    : e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
                      ? e.message
                      : "TASK_RECOVERY_FAILED",
              }),
        );
    };
  router.get(
    "/",
    route((req) => service.list(actor(req))),
  );
  router.get(
    "/:id",
    route((req) => service.detail(actor(req), id.parse(req.params.id))),
  );
  router.post(
    "/:id/save",
    route((req) => service.save(actor(req), id.parse(req.params.id))),
  );
  router.post(
    "/:id/restore",
    route((req) =>
      service.restore(
        actor(req),
        id.parse(req.params.id),
        z
          .object({
            sessionId: id,
            reviewed: z.literal(true),
            reconciliation: z.enum(["retry", "skip"]).optional(),
          })
          .strict()
          .parse(req.body),
      ),
    ),
  );
  router.delete(
    "/:id",
    route((req) => service.remove(actor(req), id.parse(req.params.id))),
  );
  return router;
}
