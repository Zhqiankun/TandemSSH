import { posix } from "node:path";
import { z } from "zod";
import { UPLOAD_TREE_MAX_ENTRIES } from "../../types/upload-tree.js";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
} from "../../types/file-upload.js";
const id = z.string().min(1).max(128);
const remotePath = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine((p) => !/[\x00-\x1f\x7f]/.test(p));
const stat = z
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
  .strict();
const entry = z
  .object({
    view: z
      .object({
        id,
        parentId: id.optional(),
        name: z.string().max(1024),
        kind: z.enum(["file", "directory"]),
        size: z
          .number()
          .int()
          .nonnegative()
          .max(UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS),
        lastModified: z.number().int().nonnegative(),
        path: z.string().max(8192),
        relativePath: z.string().max(8192),
        status: z.enum(["new", "directory", "conflict", "blocked"]),
        existing: z
          .object({
            size: z.number().int().nonnegative(),
            mtime: z.number().finite(),
            mode: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        error: z.string().max(128).optional(),
        action: z.enum(["create", "merge", "overwrite", "skip"]).optional(),
        fileResult: z
          .object({
            state: z.literal("completed"),
            transferId: z.string().uuid(),
            bytes: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            completedAt: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        result: z
          .object({
            state: z.enum([
              "created",
              "merged",
              "skipped",
              "failed",
              "unknown",
            ]),
            error: z.string().max(128).optional(),
            mode: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    directory: z.string().max(512).optional(),
    baseline: z
      .object({ stat, sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .optional(),
  })
  .strict();
/** Internal authenticated recovery data. It does not grant approval to write. */
export const uploadTreeCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    lineageId: z.string().uuid().optional(),
    userId: z.string().min(1).max(256),
    targetKey: z.string().min(1).max(8192),
    peer: z.string().min(1).max(256),
    hostIdentity: z.string().max(4096).optional(),
    path: remotePath,
    canonicalRoot: remotePath.refine((p) => posix.normalize(p) === p),
    rootSignature: z.string().min(1).max(512),
    entries: z.array(entry).min(1).max(UPLOAD_TREE_MAX_ENTRIES),
    savedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message: "UPLOAD_TREE_CHECKPOINT_INVALID",
      });
    if (Buffer.byteLength(JSON.stringify(c), "utf8") > 8 * 1024 * 1024) fail();
    const entries = new Map(c.entries.map((e) => [e.view.id, e]));
    if (entries.size !== c.entries.length) fail();
    for (const e of c.entries) {
      const seen = new Set<string>(),
        names = [e.view.name];
      let p = e.view.parentId;
      while (p) {
        const parent = entries.get(p);
        if (
          !parent ||
          parent.view.kind !== "directory" ||
          seen.has(p) ||
          names.length > 64
        ) {
          fail();
          break;
        }
        seen.add(p);
        names.unshift(parent.view.name);
        p = parent.view.parentId;
      }
      if (
        e.view.relativePath !== names.join("/") ||
        e.view.path !==
          c.canonicalRoot.replace(/\/$/, "") + "/" + names.join("/")
      )
        fail();
      if (
        e.view.status !== "blocked" &&
        (names.some(
          (n) =>
            !n ||
            n === "." ||
            n === ".." ||
            /[\\/\x00-\x1f\x7f]/.test(n) ||
            Buffer.byteLength(n, "utf8") > 255,
        ) ||
          e.view.path.length > 4096)
      )
        fail();
      if (
        e.view.fileResult &&
        (e.view.kind !== "file" || e.view.fileResult.bytes !== e.view.size)
      )
        fail();
      if ((e.directory || e.view.result) && e.view.kind !== "directory") fail();
      if (
        e.baseline &&
        (e.view.kind !== "file" || e.view.status !== "conflict")
      )
        fail();
      if (e.view.status === "conflict" && !e.baseline) fail();
      if (e.view.status === "directory" && !e.directory) fail();
      if (
        ["created", "merged"].includes(e.view.result?.state ?? "") &&
        !e.directory
      )
        fail();
    }
  });
export type UploadTreeCheckpoint = z.infer<typeof uploadTreeCheckpointSchema>;
