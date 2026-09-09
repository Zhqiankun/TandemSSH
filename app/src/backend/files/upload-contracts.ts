import { posix } from "node:path";
import { z } from "zod";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
} from "../../types/file-upload.js";
export const uploadPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine(
    (p) => !/[\x00-\x1f\x7f]/.test(p) && !!posix.basename(p) && p !== "/",
  );
export const uploadManifestSchema = z
  .object({
    name: z.string().min(1).max(4096),
    size: z
      .number()
      .int()
      .min(0)
      .max(UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS),
    lastModified: z.number().int().min(0),
    hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(UPLOAD_MAX_CHUNKS),
  })
  .strict()
  .refine((m) => m.hashes.length === Math.ceil(m.size / UPLOAD_CHUNK_BYTES));
export const prepareUploadSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256),
    path: uploadPathSchema,
    manifest: uploadManifestSchema,
  })
  .strict();
