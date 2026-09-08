import { z } from "zod";
import { filePathSchema } from "../collaboration/policies/file-policy.js";
export const transferRequestSchema = z
  .object({
    path: filePathSchema,
    localGrantId: z.string().uuid(),
    localVersion: z.string().uuid(),
    overwrite: z.boolean().default(false),
    timeoutMs: z.number().int().min(1000).max(600000).optional(),
  })
  .strict();
export const transferObservationSchema = z
  .object({ operationId: z.string().uuid() })
  .strict();
