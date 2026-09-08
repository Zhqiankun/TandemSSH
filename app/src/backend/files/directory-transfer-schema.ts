import { z } from "zod";
import { filePathSchema } from "../collaboration/policies/file-policy.js";
export const directoryPreviewSchema = z
  .object({
    direction: z.enum(["upload", "download"]),
    path: filePathSchema,
    localGrantId: z.string().uuid(),
    localVersion: z.string().uuid(),
    overwrite: z.boolean().default(false),
    timeoutMs: z.number().int().min(1000).max(600000).optional(),
    renames: z
      .array(
        z
          .object({
            relativePath: z.string().min(1).max(4096),
            name: z.string().min(1).max(255),
          })
          .strict(),
      )
      .max(4096)
      .optional(),
  })
  .strict();
export const directoryRunSchema = z
  .object({
    previewId: z.string().uuid(),
    revision: z.string().uuid(),
    choices: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            action: z.enum(["create", "merge", "overwrite", "skip"]),
          })
          .strict(),
      )
      .max(4096),
  })
  .strict();
export const directoryPageSchema = z
  .object({
    previewId: z.string().uuid(),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();
