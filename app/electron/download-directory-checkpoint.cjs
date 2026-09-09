const { z } = require("zod");
const path = require("node:path");
const id = z.string().min(1).max(128);
const filePath = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (p) => path.isAbsolute(p) && path.normalize(p) === p && !p.includes("\0"),
  );
const snapshot = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    stat: z
      .object({
        dev: z.number().finite(),
        ino: z.number().finite(),
        birthtimeMs: z.number().finite(),
        size: z.number().int().nonnegative(),
        mtimeMs: z.number().finite(),
        mode: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    platform: z.string().min(1).max(32),
    id: z.string().uuid(),
    savedAt: z.number().int().nonnegative(),
    path: filePath,
    identity: z.string().min(1).max(256),
    entries: z
      .array(
        z
          .object({
            id,
            parentId: id.optional(),
            name: z.string().max(4096),
            kind: z.enum(["file", "directory"]),
            size: z
              .number()
              .int()
              .nonnegative()
              .max(4194304 * 16384),
            status: z.enum(["new", "directory", "conflict", "blocked"]),
            action: z.enum(["create", "merge", "overwrite", "skip"]).optional(),
            error: z.string().max(128).optional(),
            directoryIdentity: z.string().min(1).max(256).optional(),
            snapshot: snapshot.optional(),
            receipt: snapshot.optional(),
            result: z
              .object({
                state: z.enum([
                  "created",
                  "merged",
                  "skipped",
                  "failed",
                  "unknown",
                  "completed",
                ]),
                error: z.string().max(128).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4096),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message: "DOWNLOAD_TREE_CHECKPOINT_INVALID",
      });
    if (Buffer.byteLength(JSON.stringify(c), "utf8") > 8 * 1024 * 1024) fail();
    const entries = new Map(c.entries.map((e) => [e.id, e]));
    if (entries.size !== c.entries.length) fail();
    for (const e of c.entries) {
      const seen = new Set();
      let p = e.parentId;
      while (p) {
        const parent = entries.get(p);
        if (
          !parent ||
          parent.kind !== "directory" ||
          seen.has(p) ||
          seen.size >= 64
        ) {
          fail();
          break;
        }
        seen.add(p);
        p = parent.parentId;
      }
      if (
        (e.directoryIdentity || e.status === "directory") &&
        e.kind !== "directory"
      )
        fail();
      if ((e.snapshot || e.receipt) && e.kind !== "file") fail();
      if (e.status === "conflict" && !e.snapshot) fail();
      if (
        ["created", "merged"].includes(e.result?.state) &&
        !e.directoryIdentity
      )
        fail();
      if (
        e.result?.state === "completed" &&
        (!e.receipt || e.kind !== "file" || e.receipt.stat.size !== e.size)
      )
        fail();
      if (e.receipt && e.result?.state !== "completed") fail();
    }
  });
function readDownloadDirectoryCheckpoint(raw) {
  try {
    return schema.parse(raw);
  } catch {
    throw Error("DOWNLOAD_TREE_CHECKPOINT_INVALID");
  }
}
module.exports = { readDownloadDirectoryCheckpoint };
