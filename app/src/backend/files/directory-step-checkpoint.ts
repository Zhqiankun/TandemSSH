import { z } from "zod";
import { uploadTreeCheckpointSchema } from "./upload-tree-checkpoint.js";
import { downloadTreeCheckpointSchema } from "./download-tree-checkpoint.js";
const fields = {
  schemaVersion: z.literal(1),
  stepId: z.string().min(1).max(128),
  entries: z.number().int().min(1).max(4096),
  completedEntryIds: z.array(z.string().uuid()).max(4096),
  choices: z
    .array(
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["create", "merge", "overwrite", "skip"]),
        })
        .strict(),
    )
    .min(1)
    .max(4096),
};
const remotePath = z
  .string()
  .startsWith("/")
  .max(4096)
  .refine((p) => !/[\x00-\x1f\x7f]/.test(p));
export const directoryStepCheckpointSchema = z
  .discriminatedUnion("direction", [
    z
      .object({
        ...fields,
        direction: z.literal("upload"),
        remoteTree: uploadTreeCheckpointSchema,
        nativeSource: z.record(z.string(), z.unknown()),
      })
      .strict(),
    z
      .object({
        ...fields,
        direction: z.literal("download"),
        path: remotePath,
        canonicalRoot: remotePath,
        remoteTree: downloadTreeCheckpointSchema,
        nativeTarget: z.record(z.string(), z.unknown()),
      })
      .strict(),
  ])
  .superRefine((c, ctx) => {
    const ids = new Set(c.choices.map((e) => e.id)),
      fail = () =>
        ctx.addIssue({ code: "custom", message: "DIRECTORY_RECOVERY_INVALID" });
    if (
      ids.size !== c.choices.length ||
      c.entries !== ids.size ||
      new Set(c.completedEntryIds).size !== c.completedEntryIds.length
    )
      fail();
    if (c.direction === "upload") {
      for (const id of c.completedEntryIds) {
        const e = c.remoteTree.entries.find((e) => e.view.id === id);
        if (
          !ids.has(id) ||
          !e ||
          !(
            e.view.fileResult ||
            ["created", "merged"].includes(e.view.result?.state ?? "")
          )
        )
          fail();
      }
    } else {
      for (const id of c.completedEntryIds) {
        const e = c.remoteTree.entries.find((e) => e.view.id === id);
        if (
          !ids.has(id) ||
          !e ||
          e.view.error ||
          !["file", "directory"].includes(e.view.kind)
        )
          fail();
      }
      const roots = c.remoteTree.entries.filter((e) => !e.view.parentId);
      if (
        roots.length !== 1 ||
        roots[0].view.path !== c.canonicalRoot ||
        roots[0].view.kind !== "directory" ||
        roots[0].view.error
      )
        fail();
    }
    if (c.remoteTree.entries.some((e) => !ids.has(e.view.id))) fail();
    if (Buffer.byteLength(JSON.stringify(c)) > 8 * 1024 * 1024) fail();
  });
export function readDirectoryStepCheckpoint(raw: unknown) {
  try {
    return directoryStepCheckpointSchema.parse(raw);
  } catch {
    throw Error("DIRECTORY_RECOVERY_INVALID");
  }
}
