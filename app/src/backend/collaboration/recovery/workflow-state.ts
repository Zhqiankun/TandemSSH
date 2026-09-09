import { z } from "zod";
import { validateTaskPlan } from "../tasks/plan.js";
import type { TaskPlanStep } from "../../../types/task-plan.js";
export const workflowReferenceSchema = z
  .object({
    id: z.string().min(1).max(256),
    revision: z.number().int().positive(),
    version: z.string().max(128),
    shellState: z.enum(["explicit-cwd", "stateful-shell"]),
  })
  .strict();
export const recoveryPlanSchema = z
  .array(z.unknown())
  .max(100)
  .transform((v) => validateTaskPlan(v as TaskPlanStep[]));
export const workflowStateSchema = z
  .object({
    initialPlan: z
      .object({
        steps: recoveryPlanSchema,
        workflow: workflowReferenceSchema.optional(),
      })
      .strict(),
    activeRunId: z.string().uuid().optional(),
    runs: z
      .array(
        z
          .object({
            summary: z
              .object({
                id: z.string().uuid(),
                taskId: z.string().uuid(),
                name: z.string().min(1).max(120),
                workflow: workflowReferenceSchema,
                state: z.enum([
                  "awaiting-authorization",
                  "authorizing",
                  "ready",
                  "running",
                  "awaiting-approval",
                  "paused-human",
                  "paused-error",
                  "completed-with-errors",
                  "completed",
                  "cancelled",
                ]),
                nextStep: z.number().int().nonnegative(),
                stepCount: z.number().int().min(1).max(100),
                operationIds: z.array(z.string().uuid()).max(5000),
                createdAt: z.number().int().nonnegative(),
                endedAt: z.number().int().nonnegative().optional(),
                hasFailures: z.boolean().optional(),
                error: z.string().max(256).optional(),
                restoredFromTaskId: z.string().uuid().optional(),
              })
              .strict(),
            steps: recoveryPlanSchema,
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
