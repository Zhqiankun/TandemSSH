import { posix } from "node:path";
import { z } from "zod";
import { DOWNLOAD_TREE_MAX_ENTRIES } from "../../types/download-tree.js";
const id = z.string().min(1).max(128);
const stat = z
  .object({
    kind: z.enum(["file", "directory"]),
    size: z.number().int().nonnegative(),
    mtime: z.number().finite(),
    atime: z.number().finite(),
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative(),
    gid: z.number().int().nonnegative(),
  })
  .strict();
/** Fixed source membership and identity, with file content checked by DownloadService. */
export const downloadTreeCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    targetKey: z.string().min(1).max(8192),
    peer: z.string().min(1).max(256),
    hostIdentity: z.string().max(4096).optional(),
    scannedAt: z.number().int().nonnegative(),
    savedAt: z.number().int().nonnegative(),
    entries: z
      .array(
        z
          .object({
            view: z
              .object({
                id,
                parentId: id.optional(),
                name: z.string().max(4096),
                path: z.string().max(8192),
                relativePath: z.string().max(8192),
                kind: z.enum(["file", "directory", "symlink", "other"]),
                size: z.number().int().nonnegative(),
                modifiedAt: z.number().finite(),
                error: z.string().max(128).optional(),
              })
              .strict(),
            stat: stat.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(DOWNLOAD_TREE_MAX_ENTRIES),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message: "DOWNLOAD_TREE_CHECKPOINT_INVALID",
      });
    if (Buffer.byteLength(JSON.stringify(c), "utf8") > 8 * 1024 * 1024) fail();
    const entries = new Map(c.entries.map((e) => [e.view.id, e]));
    if (entries.size !== c.entries.length) fail();
    for (const e of c.entries) {
      if (!e.view.error) {
        if (
          !e.stat ||
          e.stat.kind !== e.view.kind ||
          e.stat.size !== e.view.size ||
          e.stat.mtime !== e.view.modifiedAt
        )
          fail();
        if (
          !posix.isAbsolute(e.view.path) ||
          posix.normalize(e.view.path) !== e.view.path ||
          /[\x00-\x1f\x7f]/.test(e.view.path)
        )
          fail();
      } else if (e.stat) fail();
      const seen = new Set<string>();
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
        parent &&
        (e.view.relativePath !== parent.view.relativePath + "/" + e.view.name ||
          (!e.view.error &&
            e.view.path !== posix.join(parent.view.path, e.view.name)))
      )
        fail();
    }
  });
export type DownloadTreeCheckpoint = z.infer<
  typeof downloadTreeCheckpointSchema
>;
