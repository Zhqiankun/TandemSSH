import express from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { workflows } from "./production.js";
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
              : "WORKFLOW_REQUEST_FAILED";
        res.status(code.endsWith("NOT_FOUND") ? 404 : 400).json({
          error: code,
          field: typeof error.field === "string" ? error.field : undefined,
        });
      });
  };
}
router.get(
  "/",
  route((req) => ({ workflows: workflows.list(user(req)) })),
);
router.post(
  "/",
  route((req) => {
    const input = z
      .object({
        id: id.optional(),
        expectedRevision: z.number().int().positive().optional(),
        definition: z.unknown(),
        allowedHostIds: z.array(z.number().int().positive()).max(1000),
      })
      .strict()
      .parse(req.body);
    return workflows.save(user(req), {
      ...input,
      definition: input.definition,
    });
  }),
);
router.delete(
  "/:id",
  route(async (req) => {
    const input = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await workflows.remove(
      user(req),
      id.parse(req.params.id),
      input.expectedRevision,
    );
    return { removed: true };
  }),
);
router.post(
  "/inspect-import",
  route((req) => {
    user(req);
    return workflows.inspectImport(
      z.object({ definition: z.unknown() }).strict().parse(req.body).definition,
    );
  }),
);
router.get(
  "/:id/export",
  route((req) => workflows.export(user(req), id.parse(req.params.id))),
);
router.post(
  "/:id/preview",
  route((req) => {
    const input = z
      .object({ sessionId: id, parameters: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(req.body);
    return workflows.preview(
      { kind: "human", userId: user(req) },
      {
        workflowId: id.parse(req.params.id),
        sessionId: input.sessionId,
        parameters: input.parameters,
      },
    );
  }),
);
router.post(
  "/start",
  route((req) => {
    const input = z
      .object({
        previewId: id,
        requestId: z.string().min(1).max(128),
        mode: z.enum(["collaborative", "automatic"]),
      })
      .strict()
      .parse(req.body);
    return workflows.start(
      { kind: "human", userId: user(req) },
      input.previewId,
      input.requestId,
      input.mode,
    );
  }),
);
export default router;
