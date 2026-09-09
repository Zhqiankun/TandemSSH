const { z } = require("zod");
const path = require("node:path");
const filePath = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (p) => path.isAbsolute(p) && path.normalize(p) === p && !p.includes("\0"),
  );
const schema = z
  .object({
    schemaVersion: z.literal(1),
    platform: z.string().min(1).max(32),
    id: z.string().uuid(),
    savedAt: z.number().int().nonnegative(),
    entries: z
      .array(
        z
          .object({
            view: z
              .object({
                id: z.string().uuid(),
                parentId: z.string().uuid().optional(),
                name: z.string().min(1).max(4096),
                path: filePath,
                relativePath: z.string().min(1).max(32768),
                kind: z.enum(["file", "directory", "link", "other"]),
                size: z.number().int().nonnegative(),
                lastModified: z.number().int().nonnegative(),
                error: z.string().max(128).optional(),
              })
              .strict(),
            identity: z.string().min(1).max(256),
            version: z.string().min(1).max(512),
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
        message: "UPLOAD_SOURCE_CHECKPOINT_INVALID",
      });
    if (Buffer.byteLength(JSON.stringify(c), "utf8") > 8 * 1024 * 1024) fail();
    const entries = new Map(c.entries.map((e) => [e.view.id, e])),
      paths = new Set();
    if (entries.size !== c.entries.length) fail();
    for (const e of c.entries) {
      const key =
        process.platform === "win32" ? e.view.path.toLowerCase() : e.view.path;
      if (paths.has(key)) fail();
      paths.add(key);
      if (
        [".", ".."].includes(e.view.name) ||
        /[\\/\0]/.test(e.view.name) ||
        path.basename(e.view.path) !== e.view.name
      )
        fail();
      const seen = new Set();
      let p = e.view.parentId;
      while (p) {
        const parent = entries.get(p);
        if (
          !parent ||
          parent.view.kind !== "directory" ||
          parent.view.error ||
          seen.has(p) ||
          seen.size >= 64
        ) {
          fail();
          break;
        }
        seen.add(p);
        p = parent.view.parentId;
      }
      const parent = e.view.parentId ? entries.get(e.view.parentId) : undefined;
      if (
        parent
          ? e.view.path !== path.join(parent.view.path, e.view.name) ||
            e.view.relativePath !== parent.view.relativePath + "/" + e.view.name
          : e.view.relativePath !== e.view.name
      )
        fail();
    }
  });
function readUploadSourceCheckpoint(raw) {
  try {
    return schema.parse(raw);
  } catch {
    throw Error("UPLOAD_SOURCE_CHECKPOINT_INVALID");
  }
}
module.exports = { readUploadSourceCheckpoint };
