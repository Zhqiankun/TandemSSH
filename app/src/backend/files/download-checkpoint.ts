import { z } from "zod";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_CHUNKS,
} from "../../types/file-download.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  remotePath = z
    .string()
    .min(1)
    .max(4096)
    .startsWith("/")
    .refine((p) => !/[\x00-\x1f\x7f]/.test(p));
/** Internal persisted data, never an approval or an accepted HTTP request body. */
export const downloadCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    targetKey: z.string().min(1).max(8192),
    peer: z.string().min(1).max(256),
    path: remotePath,
    canonicalPath: remotePath,
    stat: z
      .object({
        size: z
          .number()
          .int()
          .nonnegative()
          .max(DOWNLOAD_CHUNK_BYTES * DOWNLOAD_MAX_CHUNKS),
        mtime: z.number().finite(),
        atime: z.number().finite(),
        mode: z.number().int().nonnegative(),
        uid: z.number().int().nonnegative(),
        gid: z.number().int().nonnegative(),
        kind: z.literal("file"),
      })
      .strict(),
    sha256: hash,
    hashes: z.array(hash).max(DOWNLOAD_MAX_CHUNKS),
    chunkBytes: z.literal(DOWNLOAD_CHUNK_BYTES),
    savedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => v.hashes.length === Math.ceil(v.stat.size / DOWNLOAD_CHUNK_BYTES),
  );
export type DownloadCheckpoint = z.infer<typeof downloadCheckpointSchema>;
