import { z } from "zod";
import { uploadTreeCheckpointSchema } from "./upload-tree-checkpoint.js";
import { uploadCheckpointSchema } from "./upload-checkpoint.js";
const member = z
  .object({
    entryId: z.string().min(1).max(128),
    state: z.enum([
      "pending",
      "paused",
      "committing",
      "unknown",
      "completed",
      "cancelled",
    ]),
    checkpoint: uploadCheckpointSchema.optional(),
  })
  .strict();
export const uploadBatchSnapshotSchema = z
  .object({
    tree: uploadTreeCheckpointSchema,
    source: z
      .string()
      .min(1)
      .max(12 * 1024 * 1024),
    members: z.array(member).max(4096),
  })
  .strict()
  .superRefine((p, ctx) => {
    const fail = () =>
        ctx.addIssue({ code: "custom", message: "UPLOAD_BATCH_INVALID" }),
      entries = new Map(p.tree.entries.map((e) => [e.view.id, e.view])),
      seen = new Set<string>();
    for (const m of p.members) {
      const e = entries.get(m.entryId);
      if (!e || e.kind !== "file" || seen.has(m.entryId)) {
        fail();
        continue;
      }
      seen.add(m.entryId);
      if (
        ["paused", "committing", "unknown"].includes(m.state) &&
        !m.checkpoint
      )
        fail();
      if (["pending", "completed"].includes(m.state) && m.checkpoint) fail();
      if (m.state === "completed" && !e.fileResult) fail();
      const c = m.checkpoint;
      if (
        c &&
        (c.userId !== p.tree.userId ||
          c.targetKey !== p.tree.targetKey ||
          c.acceptedHostKey !== p.tree.peer ||
          c.canonicalPath !== e.path ||
          c.manifest.size !== e.size ||
          c.manifest.lastModified !== e.lastModified ||
          c.constraint?.tree?.id !== (p.tree.lineageId ?? p.tree.id) ||
          c.constraint?.tree?.entryId !== e.id)
      )
        fail();
    }
    for (const e of entries.values())
      if (
        e.kind === "file" &&
        e.action !== "skip" &&
        !e.fileResult &&
        !seen.has(e.id)
      )
        fail();
  });
export type UploadBatchSnapshot = z.infer<typeof uploadBatchSnapshotSchema>;
const claim = z
  .object({
    id: z.string().uuid(),
    boot: z.string().uuid(),
    pid: z.number().int().positive(),
  })
  .strict();
export const uploadBatchRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    userId: z.string().min(1).max(256),
    payload: uploadBatchSnapshotSchema,
    state: z.enum([
      "preparing",
      "available",
      "claimed",
      "completed",
      "cancelled",
    ]),
    claim: claim.optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (r) =>
      r.userId === r.payload.tree.userId &&
      (!["preparing", "claimed"].includes(r.state) || !!r.claim),
  );
export type UploadBatchRecord = z.infer<typeof uploadBatchRecordSchema>;
