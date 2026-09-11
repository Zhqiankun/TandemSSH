import type { TFunction } from "i18next";
const known = new Set([
  "POLICY_ALLOWLIST_MISS",
  "FILE_ALLOWLIST_MISS",
  "OPAQUE_COMMAND_IN_STRICT_MODE",
  "COMMAND_NEEDS_MANUAL_REVIEW",
]);
/** Formats generated policy codes; user-written rule reasons remain literal. */
export function policyReason(
  reason: string,
  t: TFunction,
  describeSet: (id: string) => string = (id) => id,
): string {
  const code = reason.split(":", 1)[0];
  if (!known.has(code)) return reason;
  const message = t("tandem.policy.reasons." + code);
  const separator = reason.indexOf(":");
  if (
    (code === "POLICY_ALLOWLIST_MISS" || code === "FILE_ALLOWLIST_MISS") &&
    separator >= 0 &&
    reason.slice(separator + 1)
  ) {
    return (
      message +
      " · " +
      t("tandem.policy.reasonSet", {
        id: describeSet(reason.slice(separator + 1)),
      })
    );
  }
  return message;
}
