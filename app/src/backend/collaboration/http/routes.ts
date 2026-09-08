import { fileBindingsSchema } from "../tasks/plan.js";
import { localFileGrants } from "../../files/local-file-production.js";
import { localFileGrantRoutes } from "../../files/local-file-routes.js";
import { legacyCommands } from "../legacy/production.js";
import { parseLegacySource } from "../legacy/compile.js";
import { fileAutomation } from "../files/production.js";
import { fileScopeSchema } from "../policies/file-policy.js";
import express from "express";
import { z } from "zod";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  taskRuntime,
  listSessions,
  readPolicy,
  savePolicy,
} from "../tasks/production.js";

import mcpRoutes from "../../mcp/http-routes.js";
import aiTaskRoutes from "../../ai/tasks/http-routes.js";
import workflowRoutes from "../workflows/http-routes.js";
import { workflowTarget } from "../workflows/production.js";
import {
  commandMatchSchema,
  policySetsSchema,
  validatePolicySets,
} from "../policies/schema.js";
import {
  evaluateCommandPolicy,
  validateCommandAction,
} from "../policies/command-policy.js";

import { createCurrentHostRepository } from "../../database/repositories/factory.js";

const router = express.Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(AuthManager.getInstance().createAuthMiddleware());
router.use((req, res, next) => {
  const user = req as AuthenticatedRequest;
  if (!user.userId || user.apiKeyId) {
    res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
    return;
  }
  next();
});
router.use(
  "/local-files",
  localFileGrantRoutes(localFileGrants, (userId, taskId) => {
    taskRuntime.state({ kind: "human", userId }, taskId, false);
  }),
);
router.use("/mcp", mcpRoutes);
router.use("/ai-tasks", aiTaskRoutes);
router.use("/workflows", workflowRoutes);
const id = z.string().uuid();
const word = z.string().min(1).max(4096);
const match = commandMatchSchema;
const command = z
  .object({
    program: word,
    args: z.array(z.string().max(32768)).max(256),
    cwd: z.string().startsWith("/").max(4096).optional(),
  })
  .strict();
const authorization = z
  .object({
    fileBindings: fileBindingsSchema.optional(),
    planRevision: z.number().int().nonnegative().optional(),
    generation: z.number().int().positive(),
    controlEpoch: z.number().int().nonnegative(),
    policyRevision: z.number().int().positive(),
    shellReady: z.literal(true),
    directory: z.string().startsWith("/").max(4096).optional(),
    maxOperations: z.number().int().min(1).max(500),
    durationMinutes: z.number().min(1).max(480),
    matches: z.array(match).max(128).optional(),
    fileScopes: z.array(fileScopeSchema).max(128).optional(),
    allowReviewedPlan: z.boolean(),
    reconciliation: z.enum(["retry", "skip"]).optional(),
  })
  .strict();
const policy = z
  .object({
    expectedRevision: z.number().int().positive(),
    sets: policySetsSchema,
  })
  .strict();
const actor = (req: express.Request) => ({
  kind: "human" as const,
  userId: (req as AuthenticatedRequest).userId!,
});
function route(
  handler: (req: express.Request) => unknown | Promise<unknown>,
): express.RequestHandler {
  return (req, res) => {
    Promise.resolve()
      .then(() => handler(req))
      .then((value) => res.json(value))
      .catch((error) => {
        const code =
          error instanceof z.ZodError
            ? "INVALID_REQUEST"
            : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "TASK_REQUEST_FAILED";
        res
          .status(code.endsWith("NOT_FOUND") ? 404 : 400)
          .json({ error: code });
      });
  };
}
router.post(
  "/legacy/tasks",
  route((req) => {
    const p = z
      .object({
        sessionId: id,
        requestId: z.string().min(1).max(128),
        mode: z.enum(["automatic", "collaborative"]).optional(),
        source: z.unknown(),
      })
      .strict()
      .parse(req.body);
    return legacyCommands.create(actor(req).userId, {
      sessionId: p.sessionId,
      requestId: p.requestId,
      mode: p.mode,
      source: parseLegacySource(p.source),
    });
  }),
);
router.get(
  "/sessions",
  route((req) => ({ sessions: listSessions(actor(req)) })),
);
router.get(
  "/tasks",
  route((req) => ({
    tasks: taskRuntime.list(
      actor(req),
      typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
    ),
  })),
);
router.post(
  "/tasks",
  route((req) =>
    taskRuntime.create(
      actor(req),
      z
        .object({
          sessionId: id,
          requestId: z.string().min(1).max(128),
          title: z.string().min(1).max(8000),
          mode: z.enum(["collaborative", "automatic"]),
          commands: z.array(command).min(1).max(100),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
router.get(
  "/tasks/:id",
  route((req) => taskRuntime.get(actor(req), id.parse(req.params.id))),
);
router.post(
  "/tasks/:id/authorize",
  route((req) =>
    taskRuntime.authorize(
      actor(req),
      id.parse(req.params.id),
      authorization.parse(req.body),
    ),
  ),
);
router.post(
  "/tasks/:id/approve",
  route((req) => {
    const body = z
      .object({
        operationId: id,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        policyRevision: z.number().int().positive(),
        fileReviewId: id.optional(),
      })
      .strict()
      .parse(req.body);
    return taskRuntime.approve(
      actor(req),
      id.parse(req.params.id),
      body.operationId,
      body.digest,
      body.policyRevision,
      body.fileReviewId,
    );
  }),
);
router.get(
  "/tasks/:id/file-review/:operationId",
  route((req) =>
    fileAutomation.review(
      actor(req),
      id.parse(req.params.id),
      id.parse(req.params.operationId),
    ),
  ),
);
router.post(
  "/tasks/:id/cancel",
  route((req) => taskRuntime.cancel(actor(req), id.parse(req.params.id))),
);
router.post(
  "/sessions/:id/takeover",
  route((req) => {
    taskRuntime.takeover(actor(req), id.parse(req.params.id));
    return { sessions: listSessions(actor(req)) };
  }),
);
router.get(
  "/policy",
  route((req) => readPolicy(actor(req).userId)),
);
router.put(
  "/policy",
  route((req) => {
    const body = policy.parse(req.body);
    const sets = body.sets.map((set) => {
      if (!set.scope) throw new Error("INVALID_REQUEST");
      return {
        ...set,
        scope: set.scope,
        rules: set.rules.map((rule) => {
          if (!rule.match) throw new Error("INVALID_REQUEST");
          return { ...rule, match: rule.match };
        }),
      };
    });
    return savePolicy(actor(req).userId, body.expectedRevision, sets);
  }),
);
router.post(
  "/policy/trial",
  route((req) => {
    const body = z
      .object({
        sessionId: id,
        taskId: id.optional(),
        sets: policySetsSchema,
        command,
      })
      .strict()
      .parse(req.body);
    const identity = actor(req),
      target = workflowTarget(identity, body.sessionId);
    if (
      body.taskId &&
      taskRuntime.get(identity, body.taskId).sessionId !== body.sessionId
    )
      throw new Error("TASK_NOT_FOUND");
    const snapshot = {
      revision: readPolicy(identity.userId).revision,
      sets: validatePolicySets(body.sets),
    };
    const action = validateCommandAction({
      type: "terminal.command",
      ...body.command,
      cwd: body.command.cwd ?? "/",
    });
    return {
      policyRevision: snapshot.revision,
      target: {
        hostId: target.hostId,
        groupIds: target.groups,
        taskId: body.taskId,
      },
      action,
      decision: evaluateCommandPolicy(
        snapshot,
        {
          hostId: String(target.hostId),
          groupIds: target.groups,
          taskId: body.taskId,
        },
        action,
      ),
    };
  }),
);
router.get(
  "/targets",
  route(async (req) => ({
    targets: (
      await createCurrentHostRepository().listDecryptedByUserId(
        actor(req).userId,
      )
    ).map((host) => {
      const parts = (host.folder ?? "").split("/").filter(Boolean);
      let tags: string[] = [];
      try {
        const value =
          typeof host.tags === "string" ? JSON.parse(host.tags) : host.tags;
        if (Array.isArray(value))
          tags = value.filter((v): v is string => typeof v === "string");
      } catch {
        /* Invalid optional tags do not grant a scope. */
      }
      return {
        id: host.id,
        name: host.name || host.ip,
        address: host.ip,
        port: host.port || 22,
        groups: [
          ...parts.map((_, i) => parts.slice(0, i + 1).join("/")),
          ...tags.map((tag) => "tag:" + tag),
        ],
      };
    }),
  })),
);
export default router;
