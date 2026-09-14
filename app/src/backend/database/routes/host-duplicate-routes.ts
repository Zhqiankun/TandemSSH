import type { RequestHandler, Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { createCurrentHostRepository } from "../repositories/factory.js";

/** Owned-host duplication never returns or accepts authentication material. */
export function registerHostDuplicateRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
  requireDataAccess: RequestHandler,
): void {
  router.post(
    "/db/host/:id/duplicate",
    authenticateJWT,
    requireDataAccess,
    async (req, res) => {
      const identity = req as AuthenticatedRequest;
      if (!identity.userId || identity.apiKeyId) {
        res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
        return;
      }
      try {
        const hostId = z.coerce
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .parse(req.params.id);
        const body = z
          .object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(255)
              .refine((v) => !v.includes("\0")),
          })
          .strict()
          .parse(req.body);
        const result =
          await createCurrentHostRepository().duplicateOwnedForUser(
            identity.userId,
            hostId,
            body.name,
          );
        if (!result) {
          res.status(404).json({ error: "HOST_NOT_FOUND" });
          return;
        }
        res.status(201).json({ id: result.id });
      } catch (error) {
        res
          .status(error instanceof z.ZodError ? 400 : 500)
          .json({
            error:
              error instanceof z.ZodError
                ? "INVALID_HOST_DUPLICATE"
                : "HOST_DUPLICATE_FAILED",
          });
      }
    },
  );
}
