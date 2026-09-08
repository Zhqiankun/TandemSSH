import { posix } from "node:path";
import { z } from "zod";
import type { FileAction, FileScope } from "../../../types/file-operations.js";
import type {
  CommandDecision,
  CommandPolicySnapshot,
  PolicyTarget,
} from "../../../types/collaboration-operations.js";
export const filePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine((path) => !/[\x00-\x1f\x7f]/.test(path));
export const fileScopeSchema = z
  .object({
    kind: z.enum(["path", "directory"]),
    path: filePathSchema,
    access: z
      .array(z.enum(["read", "write"]))
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();
const charset = z.enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"]),
  timeoutMs = z.number().int().min(1000).max(600000).optional();
export const directoryCursorSchema = z
  .string()
  .regex(/^[a-f0-9-]{36}:[0-9]{1,5}$/);
const transfer = {
  path: filePathSchema,
  canonicalPath: filePathSchema.optional(),
  localGrantId: z.string().uuid(),
  localVersion: z.string().uuid(),
  overwrite: z.boolean(),
  timeoutMs,
};
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file.upload"), ...transfer }).strict(),
  z.object({ type: z.literal("file.download"), ...transfer }).strict(),
  z
    .object({
      type: z.literal("file.list"),
      path: filePathSchema,
      canonicalPath: filePathSchema.optional(),
      cursor: directoryCursorSchema.optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      timeoutMs,
    })
    .strict(),
  z
    .object({
      type: z.literal("file.stat"),
      path: filePathSchema,
      canonicalPath: filePathSchema.optional(),
      followLinks: z.boolean().optional(),
      timeoutMs,
    })
    .strict(),
  z
    .object({
      type: z.literal("file.read"),
      path: filePathSchema,
      canonicalPath: filePathSchema.optional(),
      charset: charset.optional(),
      timeoutMs,
    })
    .strict(),
  z
    .object({
      type: z.literal("file.write"),
      path: filePathSchema,
      canonicalPath: filePathSchema,
      proposalId: z.string().uuid(),
      version: z.string().uuid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z
        .number()
        .int()
        .min(0)
        .max(8 * 1024 * 1024),
      format: z
        .object({
          charset,
          bom: z.boolean(),
          lineEnding: z.enum(["lf", "crlf", "cr", "none"]),
        })
        .strict(),
      timeoutMs,
    })
    .strict(),
]);
export function validateFileAction(input: FileAction): FileAction {
  const result = schema.safeParse(input);
  if (!result.success) throw Error("INVALID_FILE_ACTION");
  return structuredClone(result.data);
}
export function filePaths(action: FileAction): string[] {
  return [
    ...new Set(
      [action.path, action.canonicalPath]
        .filter((path): path is string => !!path)
        .map((path) => posix.normalize(path)),
    ),
  ];
}
export function matchesFilePath(
  scope: FileScope,
  path: string,
  access: "read" | "write",
): boolean {
  const root = posix.normalize(scope.path),
    target = posix.normalize(path);
  return (
    scope.access.includes(access) &&
    (root === target ||
      (scope.kind === "directory" &&
        target.startsWith(root === "/" ? "/" : root.replace(/\/$/, "") + "/")))
  );
}
export function fileScopeAllows(
  scopes: FileScope[],
  action: FileAction,
): boolean {
  const access =
    action.type === "file.write" || action.type === "file.upload"
      ? "write"
      : "read";
  return filePaths(action).every((path) =>
    scopes.some(
      (scope) =>
        (action.type !== "file.list" || scope.kind === "directory") &&
        matchesFilePath(scope, path, access),
    ),
  );
}
export function evaluateFilePolicy(
  snapshot: CommandPolicySnapshot,
  target: PolicyTarget,
  input: FileAction,
): CommandDecision {
  const action = validateFileAction(input),
    paths = filePaths(action),
    access =
      action.type === "file.write" || action.type === "file.upload"
        ? "write"
        : "read";
  const sets = snapshot.sets.filter(
    (set) =>
      set.scope.type === "global" ||
      (set.scope.type === "host" && set.scope.id === target.hostId) ||
      (set.scope.type === "group" && target.groupIds.includes(set.scope.id)) ||
      (set.scope.type === "task" && set.scope.id === target.taskId),
  );
  const matchedRules: string[] = [],
    reasons: string[] = [];
  let denied = false,
    confirmation = false,
    allowed = false;
  for (const set of sets) {
    const rules = set.fileRules ?? [],
      matches = rules.filter((rule) =>
        paths.some((path) => matchesFilePath(rule.match, path, access)),
      );
    for (const rule of matches) {
      matchedRules.push(set.id + "/" + rule.id);
      if (rule.reason) reasons.push(rule.reason);
      if (rule.effect === "deny") denied = true;
      if (rule.effect === "confirm") confirmation = true;
    }
    const allows = rules.filter((rule) => rule.effect === "allow"),
      covered = paths.every((path) =>
        allows.some((rule) => matchesFilePath(rule.match, path, access)),
      );
    if (covered) allowed = true;
    if ((allows.length > 0 || set.strictFileAllowlist) && !covered) {
      denied = true;
      reasons.push("FILE_ALLOWLIST_MISS:" + set.id);
    }
  }
  return {
    outcome: denied ? "deny" : confirmation || !allowed ? "confirm" : "allow",
    revision: snapshot.revision,
    matchedRules,
    reasons,
  };
}
