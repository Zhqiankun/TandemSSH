import { z } from "zod";
import { posix } from "node:path";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
} from "../../types/file-upload.js";
import { uploadManifestSchema, uploadPathSchema } from "./upload-contracts.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  stat = z
    .object({
      kind: z.literal("file"),
      size: z
        .number()
        .int()
        .nonnegative()
        .max(UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS),
      mtime: z.number().finite(),
      atime: z.number().finite(),
      mode: z.number().int().nonnegative(),
      uid: z.number().int().nonnegative(),
      gid: z.number().int().nonnegative(),
    })
    .strict(),
  baseline = z.object({ stat, sha256: hash }).strict();
export const uploadCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    targetKey: z.string().min(1).max(8192),
    acceptedHostKey: z.string().min(1).max(256),
    hostIdentity: z.string().max(4096).optional(),
    path: uploadPathSchema,
    canonicalPath: uploadPathSchema,
    temporaryPath: uploadPathSchema,
    manifest: uploadManifestSchema,
    baseline: baseline.optional(),
    constraint: z
      .object({
        tree: z
          .object({
            id: z.string().uuid(),
            entryId: z.string().min(1).max(128),
          })
          .strict()
          .optional(),
        targetKey: z.string().min(1).max(8192),
        acceptedHostKey: z.string().min(1).max(256).optional(),
        canonicalPath: uploadPathSchema,
        baseline: baseline.optional(),
        parents: z
          .array(
            z
              .object({
                path: z
                  .string()
                  .min(1)
                  .max(4096)
                  .startsWith("/")
                  .refine((p) => !/[\x00-\x1f\x7f]/.test(p)),
                signature: z.string().max(512),
              })
              .strict(),
          )
          .max(128),
      })
      .strict()
      .optional(),
    receivedBytes: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    savedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (c) =>
      c.receivedBytes <= c.manifest.size &&
      (c.receivedBytes % UPLOAD_CHUNK_BYTES === 0 ||
        c.receivedBytes === c.manifest.size) &&
      posix.dirname(c.temporaryPath) === posix.dirname(c.canonicalPath) &&
      c.temporaryPath !== c.canonicalPath &&
      /^\.tandem-upload-[a-f0-9-]{36}$/.test(posix.basename(c.temporaryPath)),
  );
export type UploadCheckpoint = z.infer<typeof uploadCheckpointSchema>;
