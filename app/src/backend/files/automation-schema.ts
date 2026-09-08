import { z } from "zod";
import {
  filePathSchema,
  directoryCursorSchema,
} from "../collaboration/policies/file-policy.js";
export const fileReadSchema = z
  .object({
    path: filePathSchema,
    charset: z
      .enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"])
      .optional(),
  })
  .strict();
export const fileContentSchema = z
  .object({
    version: z.string().uuid(),
    offset: z.number().int().nonnegative().default(0),
    maxCharacters: z.number().int().min(1).max(64000).default(12000),
  })
  .strict();
const format = z
  .object({
    charset: z.enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"]),
    bom: z.boolean(),
    lineEnding: z.enum(["lf", "crlf", "cr", "none"]),
  })
  .strict();
const base = {
  version: z.string().uuid(),
  format: format.optional(),
  saveAs: filePathSchema.optional(),
};
export const fileEditSchema = z
  .object({
    ...base,
    edits: z
      .array(
        z
          .object({
            before: z.string().min(1).max(64000),
            after: z.string().max(128000),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
export const fileWriteSchema = z
  .object({ ...base, content: z.string().max(128000) })
  .strict();

export const fileListSchema = z
  .object({
    path: filePathSchema,
    cursor: directoryCursorSchema.optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const fileStatSchema = z
  .object({ path: filePathSchema, followLinks: z.boolean().default(false) })
  .strict();
