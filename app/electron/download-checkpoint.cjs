const { z } = require("zod");
const CHUNK_BYTES = 4 * 1024 * 1024,
  MAX_CHUNKS = 16384;
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  filePath = z
    .string()
    .min(1)
    .max(32768)
    .refine((p) => !p.includes("\0"));
const stat = z
  .object({
    dev: z.number().finite(),
    ino: z.number().finite(),
    birthtimeMs: z.number().finite(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(CHUNK_BYTES * MAX_CHUNKS),
    mtimeMs: z.number().finite(),
    mode: z.number().int().nonnegative(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    platform: z.string().min(1).max(32),
    id: z.string().uuid(),
    savedAt: z.number().int().nonnegative(),
    spec: z
      .object({
        name: z.string().min(1).max(255),
        size: z
          .number()
          .int()
          .nonnegative()
          .max(CHUNK_BYTES * MAX_CHUNKS),
        sha256: hash,
        hashes: z.array(hash).max(MAX_CHUNKS),
      })
      .strict(),
    parent: filePath,
    parentIdentity: z.string().min(1).max(256),
    destination: filePath,
    stagePath: filePath,
    stageIdentity: z.string().min(1).max(256),
    writtenBytes: z.number().int().nonnegative(),
    previous: z.object({ sha256: hash, stat }).strict().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.writtenBytes <= v.spec.size &&
      (v.writtenBytes % CHUNK_BYTES === 0 || v.writtenBytes === v.spec.size) &&
      v.spec.hashes.length === Math.ceil(v.spec.size / CHUNK_BYTES),
  );
function readDownloadCheckpoint(raw) {
  try {
    return schema.parse(raw);
  } catch {
    throw Error("DOWNLOAD_CHECKPOINT_INVALID");
  }
}
function checkpointStat(s) {
  return {
    dev: s.dev,
    ino: s.ino,
    birthtimeMs: s.birthtimeMs,
    size: s.size,
    mtimeMs: s.mtimeMs,
    mode: s.mode,
  };
}
module.exports = { readDownloadCheckpoint, checkpointStat };
