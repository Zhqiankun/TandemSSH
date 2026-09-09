import { z } from "zod";
import type { BackupKeybinding } from "../../types/configuration-backup.js";
import { randomUUID } from "node:crypto";
import { DEFAULT_KEYBINDING_IDS } from "../../types/keybindings.js";
import type { CustomKeybinding } from "../../types/keybindings.js";
import { redact } from "../privacy/redaction.js";
const short = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const combo = z.object({
  key: short,
  isCode: z.boolean(),
  ctrl: z.boolean(),
  alt: z.boolean(),
  shift: z.boolean(),
  meta: z.boolean(),
});
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("copy") }),
  z.object({ type: z.literal("paste") }),
  z.object({
    type: z.literal("sendControlCode"),
    controlCode: z.string().regex(/^[a-zA-Z]$/),
  }),
  z.object({
    type: z.literal("sendText"),
    text: z
      .string()
      .max(32768)
      .refine((value) => !value.includes("\0")),
    appendEnter: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("runSnippet"),
    snippetRef: z.string().max(128),
    appendEnter: z.boolean().optional(),
  }),
]);
export const backupKeybindingSchema = z
  .object({
    ref: z.string().uuid(),
    combo,
    action,
    originalEnabled: z.boolean(),
    overridesDefaultId: z.enum(DEFAULT_KEYBINDING_IDS).optional(),
  })
  .transform((row) => {
    // Keep required action typing under the backend build with relaxed null checks.
    if (!row.action) throw Error("BACKUP_KEYBINDING_INVALID");
    return { ...row, action: row.action };
  });

export function projectKeybindings(raw: unknown): {
  bindings: BackupKeybinding[];
  excluded: number;
} {
  if (raw == null) return { bindings: [], excluded: 0 };
  const rows = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(rows) || rows.length > 200)
    throw Error("BACKUP_KEYBINDING_STORE_INVALID");
  let excluded = 0;
  const bindings: BackupKeybinding[] = [];
  for (const row of rows) {
    const candidate = {
      ref: randomUUID(),
      combo: row.combo,
      action:
        row.action?.type === "runSnippet"
          ? {
              type: "runSnippet",
              snippetRef: String(row.action.snippetId ?? ""),
              appendEnter: row.action.appendEnter,
            }
          : row.action,
      originalEnabled: row.enabled,
      overridesDefaultId: row.overridesDefaultId,
    };
    const parsed = backupKeybindingSchema.parse(candidate);
    if (JSON.stringify(parsed) !== JSON.stringify(redact(parsed))) {
      excluded++;
      continue;
    }
    bindings.push(parsed);
  }
  return { bindings, excluded };
}
export function restoreKeybindings(
  rows: BackupKeybinding[],
): CustomKeybinding[] {
  const now = new Date().toISOString();
  return rows.map((row) => ({
    id: randomUUID(),
    combo: row.combo,
    action:
      row.action.type === "runSnippet"
        ? {
            type: "runSnippet",
            snippetId: "",
            appendEnter: row.action.appendEnter,
          }
        : row.action,
    enabled: false,
    needsReview: true,
    overridesDefaultId: row.overridesDefaultId,
    createdAt: now,
    updatedAt: now,
  }));
}
