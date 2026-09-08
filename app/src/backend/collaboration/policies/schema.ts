import { fileScopeSchema } from "./file-policy.js";
import { z } from "zod";
import type {
  CommandPolicySet,
  CommandPolicySnapshot,
} from "../../../types/collaboration-operations.js";
const word = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
export const commandMatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("program"), program: word }).strict(),
  z
    .object({
      kind: z.literal("program-args"),
      program: word,
      args: z
        .array(
          z
            .string()
            .max(32768)
            .refine((value) => !value.includes("\0")),
        )
        .max(256),
    })
    .strict(),
]);
const scope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("group"), id: word }).strict(),
  z.object({ type: z.literal("host"), id: word }).strict(),
  z.object({ type: z.literal("task"), id: word }).strict(),
]);
export const policySetsSchema = z
  .array(
    z
      .object({
        id: word,
        scope,
        strictAllowlist: z.boolean(),
        strictFileAllowlist: z.boolean().optional(),
        fileRules: z
          .array(
            z
              .object({
                id: word,
                effect: z.enum(["allow", "confirm", "deny"]),
                match: fileScopeSchema,
                reason: z.string().max(2000),
              })
              .strict(),
          )
          .max(256)
          .optional(),
        rules: z
          .array(
            z
              .object({
                id: word,
                effect: z.enum(["allow", "confirm", "deny"]),
                match: commandMatchSchema,
                reason: z.string().max(2000),
              })
              .strict(),
          )
          .max(256),
      })
      .strict(),
  )
  .max(64);
export function validatePolicySets(input: unknown): CommandPolicySet[] {
  if (JSON.stringify(input ?? null).length > 1000000)
    throw new Error("POLICY_TOO_LARGE");
  const parsed = policySetsSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_POLICY");
  const ids = new Set<string>();
  for (const set of parsed.data) {
    if (ids.has(set.id)) throw new Error("DUPLICATE_POLICY_ID");
    ids.add(set.id);
    const rules = new Set<string>();
    for (const rule of [...set.rules, ...(set.fileRules ?? [])]) {
      if (rules.has(rule.id)) throw new Error("DUPLICATE_RULE_ID");
      rules.add(rule.id);
    }
  }
  return structuredClone(parsed.data) as CommandPolicySet[];
}
export function validatePolicySnapshot(input: unknown): CommandPolicySnapshot {
  const value = z
    .object({ revision: z.number().int().positive(), sets: z.unknown() })
    .strict()
    .parse(input);
  return { revision: value.revision, sets: validatePolicySets(value.sets) };
}
