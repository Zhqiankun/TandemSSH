import type { TFunction } from "i18next";
const known = new Set([
  "POLICY_ALLOWLIST_MISS",
  "FILE_ALLOWLIST_MISS",
  "OPAQUE_COMMAND_IN_STRICT_MODE",
  "COMMAND_NEEDS_MANUAL_REVIEW",
]);
/** Formats generated policy codes; user-written rule reasons remain literal. */
export function policyReason(reason: string, t: TFunction): string {
  const code = reason.split(":", 1)[0];
  return known.has(code) ? t("tandem.policy.reasons." + code) : reason;
}
