import { z } from "zod";
import { validateTaskPlan } from "../tasks/plan.js";
import type { TaskExecutionCheckpoint } from "../../../types/task-recovery.js";
import type { TaskOperation } from "../../../types/collaboration-task.js";
import type { TaskPlanStep } from "../../../types/task-plan.js";
export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    host: z
      .object({
        id: z.number().int(),
        name: z.string().min(1).max(4096),
        peer: z.string().startsWith("SHA256:").max(256),
      })
      .strict(),
    title: z.string().min(1).max(8000),
    source: z.enum(["workflow", "mcp", "assistant"]),
    clientId: z.string().max(256).optional(),
    mode: z.enum(["collaborative", "automatic"]),
    steps: z
      .array(z.unknown())
      .max(100)
      .transform((steps) => validateTaskPlan(steps as TaskPlanStep[])),
    nextStep: z.number().int().nonnegative(),
    workflow: z
      .object({
        id: z.string().min(1).max(256),
        revision: z.number().int().positive(),
        version: z.string().max(128),
        shellState: z.enum(["explicit-cwd", "stateful-shell"]),
      })
      .strict()
      .optional(),
    cwd: z.string().startsWith("/").max(4096).optional(),
    hasFailures: z.boolean(),
    resourceRecoveryRequired: z.boolean(),
    reconciliationRequired: z.boolean(),
    operations: z
      .array(
        z.custom<TaskOperation>(
          (v: unknown) =>
            !!v &&
            typeof v === "object" &&
            typeof (v as TaskOperation).id === "string" &&
            typeof (v as TaskOperation).status === "string" &&
            typeof (v as TaskOperation).action?.type === "string",
        ),
      )
      .max(5000),
    createdAt: z.number().int().nonnegative(),
    savedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => v.nextStep <= v.steps.length && (v.source !== "mcp" || !!v.clientId),
  );
export function readCheckpoint(raw: unknown): TaskExecutionCheckpoint {
  try {
    const cp = checkpointSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(cp)) > 8 * 1024 * 1024) throw Error();
    return cp as TaskExecutionCheckpoint;
  } catch {
    throw Error("TASK_RECOVERY_INVALID");
  }
}
export const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    checkpoint: checkpointSchema,
    state: z.enum(["available", "live", "claimed", "consumed"]),
    updatedAt: z.number().int().nonnegative(),
    claim: z
      .object({
        id: z.string().uuid(),
        boot: z.string().uuid(),
        pid: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((r) => !["live", "claimed"].includes(r.state) || !!r.claim);
export type TaskRecoveryRecord = z.infer<typeof recordSchema>;
