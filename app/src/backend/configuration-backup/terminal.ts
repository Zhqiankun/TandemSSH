import { randomUUID } from "node:crypto";
import {
  terminalAppearanceSchema,
  backupTerminalThemeSchema,
  type TerminalAppearance,
  type BackupTerminalTheme,
} from "../../types/terminal-appearance.js";
import type { BackupWarning } from "../../types/configuration-backup.js";
import { redact } from "../privacy/redaction.js";
function decode(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  if (Buffer.byteLength(raw) > 256 * 1024)
    throw Error("BACKUP_TERMINAL_INVALID");
  return JSON.parse(raw);
}
export function projectTerminalAppearance(
  raw: unknown,
  warnings: BackupWarning[],
  path: string,
): TerminalAppearance | undefined {
  if (raw === undefined || raw === null) return undefined;
  try {
    const value = decode(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("invalid");
    const fields = Object.fromEntries(
      Object.entries(value).filter(
        ([, v]) => v !== null && v !== undefined && v !== "",
      ),
    );
    const safe = terminalAppearanceSchema.parse(fields);
    if (JSON.stringify(redact(safe)) !== JSON.stringify(safe))
      throw Error("secret");
    if (Object.keys(fields).some((key) => !Object.hasOwn(safe, key)))
      warnings.push({ code: "TERMINAL_FIELDS_EXCLUDED", path });
    return safe;
  } catch {
    warnings.push({ code: "TERMINAL_FIELDS_EXCLUDED", path });
    return undefined;
  }
}
export function projectTerminalThemes(
  raw: unknown,
  warnings: BackupWarning[],
): BackupTerminalTheme[] {
  if (raw === undefined || raw === null) return [];
  try {
    const values = decode(raw);
    if (!Array.isArray(values) || values.length > 100) throw Error("invalid");
    const out: BackupTerminalTheme[] = [];
    for (const value of values) {
      const parsed = backupTerminalThemeSchema.safeParse({
        ...value,
        ref: randomUUID(),
      });
      if (
        !parsed.success ||
        JSON.stringify(redact(parsed.data)) !== JSON.stringify(parsed.data)
      ) {
        warnings.push({
          code: "TERMINAL_THEME_EXCLUDED",
          path: "terminalThemes",
        });
        continue;
      }
      out.push(parsed.data);
    }
    return out;
  } catch {
    warnings.push({ code: "TERMINAL_THEME_EXCLUDED", path: "terminalThemes" });
    return [];
  }
}
export function appendTerminalThemes(
  existing: unknown,
  incoming: BackupTerminalTheme[],
) {
  const parsed =
    existing === undefined || existing === null ? [] : decode(existing);
  if (!Array.isArray(parsed)) throw Error("BACKUP_TERMINAL_INVALID");
  if (parsed.length + incoming.length > 100)
    throw Error("BACKUP_TERMINAL_THEME_LIMIT");
  const names = new Set(parsed.map((x) => String(x?.name ?? "")));
  return [
    ...parsed,
    ...incoming.map((theme) => {
      let name = theme.name,
        suffix = 2;
      while (names.has(name))
        name = theme.name.slice(0, 230) + " (" + suffix++ + ")";
      names.add(name);
      return { id: randomUUID(), name, colors: theme.colors };
    }),
  ];
}
