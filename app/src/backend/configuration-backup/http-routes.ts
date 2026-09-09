import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/index.js";
import type { ConfigurationBackupService } from "./service.js";
import { MAX_BACKUP_BYTES } from "./schema.js";
export function configurationBackupRoutes(
  service: ConfigurationBackupService,
  authenticate: express.RequestHandler,
) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    const actor = req as AuthenticatedRequest;
    res.setHeader("Cache-Control", "no-store");
    if (!actor.userId || actor.apiKeyId)
      return res.status(403).json({ code: "TRUSTED_UI_REQUIRED" });
    next();
  });
  const handle =
    (
      fn: (
        req: express.Request,
        res: express.Response,
        userId: string,
      ) => Promise<unknown>,
    ): express.RequestHandler =>
    (req, res) => {
      void fn(req, res, (req as AuthenticatedRequest).userId).catch((error) => {
        const code =
          error instanceof z.ZodError
            ? "BACKUP_INVALID"
            : error instanceof Error &&
                /^(BACKUP_|WORKFLOW_|DATA_|HOST_)[A-Z_]+$/.test(error.message)
              ? error.message
              : "BACKUP_FAILED";
        res
          .status(
            code.includes("NOT_FOUND")
              ? 404
              : code.includes("CHANGED")
                ? 409
                : 400,
          )
          .json({ code });
      });
    };
  router.post(
    "/export/preview",
    handle(async (_req, res, user) =>
      res.json(await service.previewExport(user)),
    ),
  );
  router.get(
    "/export/:id",
    handle(async (req, res, user) => {
      const data = await service.download(
        user,
        z.string().uuid().parse(req.params.id),
      );
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="TandemSSH-configuration.json"',
      );
      res.send(data);
    }),
  );
  router.post(
    "/import/preview",
    express.text({
      type: "application/vnd.tandemssh.backup+json",
      limit: MAX_BACKUP_BYTES,
    }),
    handle(async (req, res, user) => {
      if (typeof req.body !== "string") throw Error("BACKUP_INVALID");
      res.json(await service.previewImport(user, req.body));
    }),
  );
  router.post(
    "/import/:id",
    handle(async (req, res, user) => {
      const input = z
        .object({ confirmed: z.literal(true), restorePreferences: z.boolean() })
        .strict()
        .parse(req.body);
      res.json(
        await service.apply(
          user,
          z.string().uuid().parse(req.params.id),
          input.restorePreferences,
        ),
      );
    }),
  );
  const bodyError: express.ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === "entity.too.large") {
      res.status(413).json({ code: "BACKUP_TOO_LARGE" });
      return;
    }
    next(error);
  };
  router.use(bodyError);
  return router;
}
