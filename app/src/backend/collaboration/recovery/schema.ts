import {
  workflowStateSchema,
  workflowReferenceSchema,
} from "./workflow-state.js";
import { aiRecoverySchema } from "../../ai/tasks/recovery-state.js";
import { z } from "zod";
import { validateTaskPlan } from "../tasks/plan.js";
import type { TaskExecutionCheckpoint } from "../../../types/task-recovery.js";
import type { TaskOperation } from "../../../types/collaboration-task.js";
import type { TaskPlanStep } from "../../../types/task-plan.js";
export const checkpointSchema = z
  .object({
    ai: aiRecoverySchema.optional(),
    completed: z.boolean().optional(),
    workflowState: workflowStateSchema.optional(),
    workflowCwd: z.string().startsWith("/").max(4096).optional(),
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
    workflow: workflowReferenceSchema.optional(),
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
    (v) =>
      v.nextStep <= v.steps.length &&
      (v.source !== "mcp" || !!v.clientId) &&
      (v.source === "assistant"
        ? !!v.ai &&
          v.ai.view.taskId === v.id &&
          v.ai.view.goal === v.title &&
          v.ai.view.mode === v.mode
        : !v.ai),
  )
  .superRefine((v, ctx) => {
    const w = v.workflowState;
    if (!w) {
      if (v.ai?.waitingWorkflow)
        ctx.addIssue({ code: "custom", message: "WORKFLOW_RECOVERY_INVALID" });
      return;
    }
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "WORKFLOW_RECOVERY_INVALID" });
    const ids = new Set(w.runs.map((r) => r.summary.id)),
      operations = new Map(v.operations.map((op) => [op.id, op]));
    if (
      ids.size !== w.runs.length ||
      operations.size !== v.operations.length ||
      w.initialPlan.steps.length
    )
      fail();
    for (const r of w.runs) {
      if (
        r.summary.taskId !== v.id ||
        r.summary.stepCount !== r.steps.length ||
        r.summary.nextStep > r.steps.length ||
        new Set(r.summary.operationIds).size !== r.summary.operationIds.length
      )
        fail();
      for (const id of r.summary.operationIds)
        if (operations.get(id)?.workflowRunId !== r.summary.id) fail();
    }
    for (const op of v.operations)
      if (
        op.workflowRunId &&
        !w.runs.some(
          (r) =>
            r.summary.id === op.workflowRunId &&
            r.summary.operationIds.includes(op.id),
        )
      )
        fail();
    const active = w.runs.find((r) => r.summary.id === w.activeRunId);
    if (
      w.activeRunId &&
      (!active ||
        JSON.stringify(active.steps) !== JSON.stringify(v.steps) ||
        JSON.stringify(active.summary.workflow) !==
          JSON.stringify(v.workflow) ||
        active.summary.nextStep !== v.nextStep)
    )
      fail();
    if (!w.activeRunId && v.steps.length) fail();
    if (v.ai?.waitingWorkflow && !ids.has(v.ai.waitingWorkflow.id)) fail();
  });
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
