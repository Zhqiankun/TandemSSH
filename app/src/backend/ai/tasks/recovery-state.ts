import { z } from "zod";
import type { AiExecutionCheckpoint } from "../../../types/ai-task-recovery.js";
const id = z.string().uuid(),
  text = z.string().max(16000),
  call = z
    .object({
      id: z.string().min(1).max(256),
      name: z.string().min(1).max(128),
      arguments: z.record(z.string(), z.unknown()),
      providerSignature: z.string().max(65536).optional(),
    })
    .strict();
const message = z
  .object({
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string().max(64000),
    toolCalls: z.array(call).max(8).optional(),
    toolCallId: z.string().max(256).optional(),
    toolName: z.string().max(128).optional(),
  })
  .strict();
export const aiRecoverySchema = z
  .object({
    schemaVersion: z.literal(1),
    waitingWorkflow: z
      .object({ id, callId: z.string().min(1).max(256).optional() })
      .strict()
      .optional(),
    providerIdentity: z.string().min(1).max(128),
    view: z
      .object({
        id,
        taskId: id,
        sessionId: z.string().min(1).max(256),
        providerId: z.number().int().positive(),
        providerLabel: z.string().min(1).max(256),
        model: z.string().min(1).max(256),
        goal: z.string().min(1).max(8000),
        mode: z.enum(["automatic", "collaborative"]),
        phase: z.enum([
          "planning",
          "awaiting-authorization",
          "thinking",
          "executing",
          "awaiting-approval",
          "awaiting-answer",
          "paused-human",
          "paused-error",
          "completed-with-errors",
          "completed",
          "cancelled",
        ]),
        turns: z.number().int().min(0).max(64),
        maxTurns: z.number().int().min(2).max(64),
        messages: z
          .array(
            z
              .object({
                id,
                role: z.enum(["user", "assistant"]),
                content: text,
                status: z.enum(["streaming", "complete", "interrupted"]),
              })
              .strict(),
          )
          .max(80),
        question: z
          .object({ id, text: z.string().max(4000) })
          .strict()
          .optional(),
        error: z.string().max(256).optional(),
        createdAt: z.number().int().nonnegative(),
        recoveredFrom: z.object({ runId: id, taskId: id }).strict().optional(),
      })
      .strict(),
    history: z.array(z.array(message).max(17)).max(128),
    question: z
      .object({
        id,
        text: z.string().max(4000),
        answer: z.string().max(8000).optional(),
      })
      .strict()
      .optional(),
    interruptedModel: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.view.turns > v.view.maxTurns ||
      Buffer.byteLength(JSON.stringify(v.history)) > 256000
    )
      ctx.addIssue({ code: "custom", message: "AI_RECOVERY_LIMIT" });
    if (
      v.waitingWorkflow?.callId &&
      !v.history.some((group) =>
        group[0]?.toolCalls?.some(
          (c) =>
            c.id === v.waitingWorkflow!.callId && c.name === "run_workflow",
        ),
      )
    )
      ctx.addIssue({ code: "custom", message: "AI_RECOVERY_WORKFLOW_INVALID" });
    for (const group of v.history) {
      const calls = group[0]?.toolCalls ?? [],
        results = group.filter((m) => m.role === "tool");
      if (
        calls.length !== results.length ||
        new Set(calls.map((c) => c.id)).size !== calls.length ||
        calls.some(
          (c) =>
            results.filter(
              (r) => r.toolCallId === c.id && r.toolName === c.name,
            ).length !== 1,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "AI_RECOVERY_HISTORY_INVALID",
        });
    }
  });
export function readAiRecovery(raw: unknown): AiExecutionCheckpoint {
  try {
    return aiRecoverySchema.parse(raw) as AiExecutionCheckpoint;
  } catch {
    throw Error("AI_RECOVERY_INVALID");
  }
}
