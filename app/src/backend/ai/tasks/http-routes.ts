import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { aiTasks } from "./production.js";
const router = express.Router();
const id = z.string().uuid();
const user = (req: express.Request) => {
  const actor = req as AuthenticatedRequest;
  if (!actor.userId || actor.apiKeyId) throw new Error("TRUSTED_UI_REQUIRED");
  return actor.userId;
};
function route(
  fn: (req: express.Request) => unknown | Promise<unknown>,
): express.RequestHandler {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((value) => res.json(value))
      .catch((error) => {
        const code =
          error instanceof z.ZodError
            ? "INVALID_REQUEST"
            : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "AI_TASK_REQUEST_FAILED";
        res
          .status(code.endsWith("NOT_FOUND") ? 404 : 400)
          .json({ error: code });
      });
  };
}
router.get(
  "/",
  route((req) => ({
    runs: aiTasks.list(
      user(req),
      typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
    ),
  })),
);
router.post(
  "/",
  route((req) =>
    aiTasks.create(
      user(req),
      z
        .object({
          sessionId: id,
          requestId: z.string().min(1).max(128),
          providerId: z.number().int().positive(),
          model: z.string().min(1).max(256),
          goal: z.string().min(1).max(8000),
          mode: z.enum(["collaborative", "automatic"]),
          maxTurns: z.number().int().min(2).max(64).default(20),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
router.get(
  "/:id",
  route((req) => aiTasks.get(user(req), id.parse(req.params.id))),
);
router.post(
  "/:id/stop",
  route((req) => aiTasks.stop(user(req), id.parse(req.params.id))),
);
router.post(
  "/:id/reply",
  route((req) => {
    const input = z
      .object({ questionId: id, answer: z.string().min(1).max(8000) })
      .strict()
      .parse(req.body);
    return aiTasks.reply(
      user(req),
      id.parse(req.params.id),
      input.questionId,
      input.answer,
    );
  }),
);
router.post(
  "/:id/budget",
  route((req) => {
    const input = z
      .object({ maxTurns: z.number().int().min(2).max(64) })
      .strict()
      .parse(req.body);
    return aiTasks.extendBudget(
      user(req),
      id.parse(req.params.id),
      input.maxTurns,
    );
  }),
);
export default router;
