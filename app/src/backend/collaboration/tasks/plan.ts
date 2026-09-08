import { z } from "zod";
import { validateCommandAction } from "../policies/command-policy.js";
import { filePathSchema } from "../policies/file-policy.js";
import {
  isTaskFileStep,
  type TaskPlanStep,
  type TaskFileStep,
  type TaskFileBindings,
} from "../../../types/task-plan.js";
import type { OperationAction } from "../../../types/collaboration-operations.js";
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
export const fileBindingsSchema = z
  .record(
    name,
    z
      .object({
        localGrantId: z.string().uuid(),
        localVersion: z.string().uuid(),
      })
      .strict(),
  )
  .refine((v) => Object.keys(v).length <= 64);
const fileStep = z
  .object({
    kind: z.literal("file-transfer"),
    stepId: name,
    name: z.string().min(1).max(120),
    direction: z.enum(["upload", "download"]),
    path: filePathSchema,
    localFile: name,
    overwrite: z.boolean(),
    timeoutMs: z.number().int().min(1000).max(600000).optional(),
    onFailure: z.enum(["stop", "continue"]).optional(),
  })
  .strict();
export function validateTaskPlan(plan: TaskPlanStep[]) {
  if (
    !Array.isArray(plan) ||
    plan.length > 100 ||
    Buffer.byteLength(JSON.stringify(plan)) > 512000
  )
    throw Error("INVALID_WORKFLOW_RUN");
  for (const step of plan) {
    if (isTaskFileStep(step)) {
      fileStep.parse(step);
    } else
      validateCommandAction({
        type: "terminal.command",
        program: step.program,
        args: step.args,
        cwd: step.cwd ?? "/",
        timeoutMs: step.timeoutMs,
      });
  }
  return structuredClone(plan);
}
export function fileStepAction(
  step: TaskFileStep,
  bindings: TaskFileBindings,
): Extract<OperationAction, { type: "file.upload" | "file.download" }> {
  const binding = bindings[step.localFile];
  if (!binding) throw Error("WORKFLOW_FILE_BINDING_REQUIRED");
  return {
    type: step.direction === "upload" ? "file.upload" : "file.download",
    path: step.path,
    overwrite: step.overwrite,
    localGrantId: binding.localGrantId,
    localVersion: binding.localVersion,
    timeoutMs: step.timeoutMs,
  };
}

/** Continue only verified, ordinary failures; never authorization loss or uncertain writes. */
export function canContinueStepFailure(
  result: import("../operations/gateway.js").OperationView,
): boolean {
  if (result.status !== "failed" || result.auditGap) return false;
  if (result.action.type === "terminal.command") return !result.error;
  if (
    result.action.type !== "file.upload" &&
    result.action.type !== "file.download"
  )
    return false;
  const file = result.fileResult;
  if (
    file?.commitMayHaveOccurred ||
    file?.temporaryPath ||
    file?.transfer?.cleanupRequired
  )
    return false;
  return [
    "FILE_NOT_FOUND",
    "FILE_PERMISSION_DENIED",
    "UPLOAD_SOURCE_CHANGED",
    "DOWNLOAD_SOURCE_CHANGED",
    "DOWNLOAD_TARGET_CHANGED",
  ].includes(result.error ?? "");
}
