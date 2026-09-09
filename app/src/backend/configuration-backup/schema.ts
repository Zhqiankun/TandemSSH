import { z } from "zod";
import { randomUUID } from "node:crypto";
import { parseWorkflow } from "../collaboration/workflows/definition.js";
import { redact } from "../privacy/redaction.js";
import { sanitizeUiPreferences } from "../../types/ui-preferences.js";
import type {
  ConfigurationBackup,
  BackupWarning,
} from "../../types/configuration-backup.js";
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\u0000]/.test(value));
const hostSchema = z.object({
  ref: z.string().uuid(),
  name: text(512),
  ip: text(2048)
    .min(1)
    .refine((value) => !/[\r\n]/.test(value)),
  port: z.number().int().min(1).max(65535),
  username: text(256)
    .min(1)
    .refine((value) => !/[\r\n]/.test(value)),
  folder: text(2048).default(""),
  tags: z.array(text(128)).max(64).default([]),
  pin: z.boolean().default(false),
  notes: text(16384).default(""),
  credentialRef: text(256),
  originalAuthType: text(40),
});
const fileSchema = z.object({
  format: z.literal("tandemssh-configuration"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  hosts: z.array(hostSchema).max(500),
  workflows: z
    .array(z.object({ ref: z.string().uuid(), definition: z.unknown() }))
    .max(128),
  preferences: z.unknown().optional(),
});
function ignored(
  input: unknown,
  safe: unknown,
  path: string,
  warnings: BackupWarning[],
  depth = 0,
) {
  if (
    depth > 12 ||
    warnings.length >= 128 ||
    !input ||
    typeof input !== "object"
  )
    return;
  if (Array.isArray(input)) {
    input.forEach((value, index) =>
      ignored(
        value,
        Array.isArray(safe) ? safe[index] : undefined,
        `${path}[${index}]`,
        warnings,
        depth + 1,
      ),
    );
    return;
  }
  const clean =
    safe && typeof safe === "object" ? (safe as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(input)) {
    if (warnings.length >= 128) return;
    const at = `${path}.${String(redact(key.slice(0, 80)))}`;
    if (!Object.hasOwn(clean, key))
      warnings.push({ code: "IGNORED_FIELD", path: at });
    else ignored(value, clean[key], at, warnings, depth + 1);
  }
}
function inspectReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inspectReferences);
  if (!value || typeof value !== "object") return value;
  const usedKeys = new Set(Object.keys(value));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry], index) => {
      const reference =
        entry &&
        typeof entry === "object" &&
        ((entry as { type?: unknown }).type === "secret-ref" ||
          typeof (entry as { param?: unknown }).param === "string");
      if (!reference) return [key, inspectReferences(entry)];
      let safeKey = `reference_${index}`;
      while (usedKeys.has(safeKey)) safeKey += "_";
      usedKeys.add(safeKey);
      return [safeKey, { name: key, value: inspectReferences(entry) }];
    }),
  );
}

export function parseConfigurationBackup(input: unknown): {
  payload: ConfigurationBackup;
  warnings: BackupWarning[];
} {
  const parsed = fileSchema.parse(input),
    warnings: BackupWarning[] = [];
  const hostRefs = new Set(parsed.hosts.map((host) => host.ref)),
    workflowRefs = new Set(parsed.workflows.map((flow) => flow.ref));
  if (
    hostRefs.size !== parsed.hosts.length ||
    workflowRefs.size !== parsed.workflows.length
  )
    throw Error("BACKUP_DUPLICATE_REFERENCE");
  const payload: ConfigurationBackup = {
    ...parsed,
    hosts: [],
    workflows: [],
    preferences: undefined,
  };
  for (let index = 0; index < parsed.hosts.length; index++) {
    const host = parsed.hosts[index],
      safe = redact(host) as typeof host;
    if (safe.ip !== host.ip || safe.username !== host.username) {
      warnings.push({ code: "HOST_SECRET_EXCLUDED", path: `hosts[${index}]` });
      continue;
    }
    payload.hosts.push(hostSchema.parse(safe));
  }
  for (let index = 0; index < parsed.workflows.length; index++) {
    const row = parsed.workflows[index],
      definition = parseWorkflow(row.definition);
    const inspect = inspectReferences(definition);
    if (JSON.stringify(redact(inspect)) !== JSON.stringify(inspect)) {
      warnings.push({
        code: "WORKFLOW_SECRET_EXCLUDED",
        path: `workflows[${index}]`,
      });
      continue;
    }
    payload.workflows.push({ ref: row.ref, definition });
  }
  if (parsed.preferences !== undefined) {
    const preferences = sanitizeUiPreferences(parsed.preferences);
    payload.preferences = sanitizeUiPreferences(redact(preferences));
    if (JSON.stringify(preferences) !== JSON.stringify(payload.preferences))
      warnings.push({
        code: "PREFERENCE_SECRET_REDACTED",
        path: "preferences",
      });
  }
  ignored(input, payload, "backup", warnings);
  if (JSON.stringify(parsed.hosts) !== JSON.stringify(payload.hosts))
    warnings.push({ code: "RECOGNIZED_SECRET_REDACTED", path: "hosts" });
  if (payload.hosts.length)
    warnings.push({ code: "CREDENTIAL_REBIND_REQUIRED", path: "hosts" });
  if (payload.workflows.length)
    warnings.push({
      code: "WORKFLOW_HOST_BINDING_REQUIRED",
      path: "workflows",
    });
  warnings.push({ code: "NO_AUTOMATIC_EXECUTION", path: "backup" });
  return { payload, warnings };
}
export function projectConfigurationBackup(
  hosts: Array<Record<string, unknown>>,
  workflows: Array<{ definition: unknown }>,
  preferences?: unknown,
) {
  const warnings: BackupWarning[] = [],
    entries: unknown[] = [];
  for (let index = 0; index < hosts.length; index++) {
    const host = hosts[index];
    if (host.connectionType && host.connectionType !== "ssh") {
      warnings.push({
        code: "UNSUPPORTED_CONNECTION_TYPE",
        path: `hosts[${index}]`,
      });
      continue;
    }
    let tags = host.tags;
    try {
      if (typeof tags === "string") tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
    entries.push({
      ref: randomUUID(),
      name: String(host.name ?? ""),
      ip: host.ip,
      port: host.port,
      username: host.username,
      folder: String(host.folder ?? ""),
      tags: Array.isArray(tags) ? tags : [],
      pin: !!host.pin,
      notes: String(host.notes ?? ""),
      credentialRef: `source-credential:${String(host.credentialId ?? host.id)}`,
      originalAuthType: String(host.authType ?? "password"),
    });
  }
  const result = parseConfigurationBackup({
    format: "tandemssh-configuration",
    version: 1,
    createdAt: new Date().toISOString(),
    hosts: entries,
    workflows: workflows.map((row) => ({
      ref: randomUUID(),
      definition: row.definition,
    })),
    preferences,
  });
  return {
    payload: result.payload,
    warnings: [
      ...warnings,
      { code: "SECRETS_AND_STARTUP_EXCLUDED", path: "hosts" },
      ...result.warnings,
    ],
  };
}
