import {
  fileReadSchema,
  fileListSchema,
  fileStatSchema,
  fileContentSchema,
  fileEditSchema,
  fileWriteSchema,
} from "../files/automation-schema.js";
import { z } from "zod";
const id = z.string().uuid(),
  requestId = z.string().min(1).max(128);
export const coreInputSchemas = {
  "files.list": fileListSchema.extend({ taskId: id, requestId }).strict(),
  "files.stat": fileStatSchema.extend({ taskId: id, requestId }).strict(),
  "files.read": fileReadSchema.extend({ taskId: id, requestId }).strict(),
  "files.content": fileContentSchema.extend({ taskId: id }).strict(),
  "files.edit": fileEditSchema.extend({ taskId: id, requestId }).strict(),
  "files.write": fileWriteSchema.extend({ taskId: id, requestId }).strict(),
  status: z.object({}).strict(),
  "workflows.list": z
    .object({
      hostId: z.number().int().positive(),
      offset: z.number().int().nonnegative().default(0),
    })
    .strict(),
  "workflows.get": z
    .object({ hostId: z.number().int().positive(), workflowId: id })
    .strict(),
  "workflows.preview": z
    .object({
      workflowId: id,
      sessionId: id,
      parentTaskId: id.optional(),
      parameters: z.record(z.string(), z.unknown()),
    })
    .strict(),
  "workflows.start": z
    .object({
      previewId: id,
      requestId,
      mode: z.enum(["collaborative", "automatic"]).default("collaborative"),
    })
    .strict(),
  "workflows.run": z.object({ taskId: id, previewId: id, requestId }).strict(),
  "workflows.result": z.object({ taskId: id, workflowRunId: id }).strict(),
  "hosts.list": z.object({}).strict(),
  "sessions.list": z
    .object({ hostId: z.number().int().positive().optional() })
    .strict(),
  "sessions.open": z
    .object({ hostId: z.number().int().positive(), requestId })
    .strict(),
  "sessions.output": z
    .object({
      sessionId: id,
      cursor: z.number().int().nonnegative().optional(),
      maxCharacters: z.number().int().min(1).max(12000).default(8000),
    })
    .strict(),
  "tasks.create": z
    .object({
      sessionId: id,
      requestId,
      goal: z.string().min(1).max(8000),
      mode: z.enum(["collaborative", "automatic"]).default("collaborative"),
    })
    .strict(),
  "tasks.get": z.object({ taskId: id }).strict(),
  "tasks.cancel": z.object({ taskId: id }).strict(),
  "tasks.complete": z.object({ taskId: id }).strict(),
  "commands.propose": z
    .object({
      taskId: id,
      requestId,
      program: z.string().min(1).max(1024),
      args: z.array(z.string().max(32768)).max(256).default([]),
      cwd: z.string().startsWith("/").max(4096).optional(),
    })
    .strict(),
  "operations.get": z.object({ taskId: id, operationId: id }).strict(),
  "operations.wait": z
    .object({
      taskId: id,
      operationId: id,
      timeoutMs: z.number().int().min(0).max(20000).default(15000),
    })
    .strict(),
};
export type CoreMethod = keyof typeof coreInputSchemas;
export const CORE_METHODS = Object.keys(coreInputSchemas) as CoreMethod[];
export interface CoreBridgePort {
  invoke(
    method: CoreMethod,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
export function parseCoreRequest(
  method: unknown,
  parameters: unknown,
): { method: CoreMethod; parameters: Record<string, unknown> } {
  if (typeof method !== "string" || !Object.hasOwn(coreInputSchemas, method))
    throw new Error("MCP_METHOD_NOT_ALLOWED");
  const checked = coreInputSchemas[method as CoreMethod].safeParse(parameters);
  if (!checked.success) throw new Error("INVALID_REQUEST");
  return { method: method as CoreMethod, parameters: checked.data };
}
