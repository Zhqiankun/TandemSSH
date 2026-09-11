import type {
  CommandAction,
  CommandDecision,
  CommandMatch,
  CommandPolicySnapshot,
  PolicyTarget,
} from "../../../types/collaboration-operations.js";

export function validateCommandAction(value: CommandAction): CommandAction {
  if (
    !value ||
    value.type !== "terminal.command" ||
    typeof value.program !== "string" ||
    !value.program.trim() ||
    value.program.includes("\0") ||
    !Array.isArray(value.args) ||
    value.args.length > 256 ||
    value.args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    typeof value.cwd !== "string" ||
    !value.cwd.startsWith("/") ||
    value.cwd.includes("\0") ||
    (value.timeoutMs !== undefined &&
      (!Number.isInteger(value.timeoutMs) ||
        value.timeoutMs < 1000 ||
        value.timeoutMs > 600000))
  ) {
    throw new Error("INVALID_ACTION");
  }
  const action: CommandAction = {
    type: "terminal.command",
    program: value.program,
    args: [...value.args],
    cwd: value.cwd,
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
  };
  if (new TextEncoder().encode(JSON.stringify(action)).length > 48 * 1024)
    throw new Error("ACTION_TOO_LARGE");
  return action;
}

export function matchesCommand(
  match: CommandMatch,
  action: CommandAction,
  deny = false,
): boolean {
  // A basename deny also covers an explicitly qualified path. An allow never
  // treats /tmp/ls as /usr/bin/ls: executable identity must be resolved by the
  // trusted SSH adapter, not supplied as a claim by a model.
  const sameProgram =
    match.program === action.program ||
    (deny &&
      !match.program.includes("/") &&
      action.program.split("/").at(-1) === match.program);
  return (
    sameProgram &&
    (match.kind === "program" ||
      (match.args.length === action.args.length &&
        match.args.every((arg, i) => arg === action.args[i])))
  );
}

const OPAQUE_PROGRAMS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "eval",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "powershell",
  "pwsh",
  "cmd",
  "sudo",
  "su",
  "env",
  "xargs",
  // Interactive programs may accept further commands after initial dispatch.
  "vi",
  "vim",
  "nvim",
  "nano",
  "emacs",
  "less",
  "more",
  "top",
  "htop",
  "btop",
  "tmux",
  "screen",
]);

/** Pure rule composition. This does not claim to sandbox a remote operating
 * system or prove the behavior of arbitrary executables/scripts. */
export function evaluateCommandPolicy(
  snapshot: CommandPolicySnapshot,
  target: PolicyTarget,
  action: CommandAction,
): CommandDecision {
  validateCommandAction(action);
  const sets = snapshot.sets.filter(
    (set) =>
      set.scope.type === "global" ||
      (set.scope.type === "host" && set.scope.id === target.hostId) ||
      (set.scope.type === "group" && target.groupIds.includes(set.scope.id)) ||
      (set.scope.type === "task" && set.scope.id === target.taskId),
  );
  const matchedRules: string[] = [];
  const reasons: string[] = [];
  let denied = false;
  let confirmation = false;
  let allowed = false;
  for (const set of sets) {
    const matches = set.rules.filter((rule) =>
      matchesCommand(rule.match, action, rule.effect === "deny"),
    );
    for (const rule of matches) {
      matchedRules.push(`${set.id}/${rule.id}`);
      if (rule.reason) reasons.push(rule.reason);
      if (rule.effect === "deny") denied = true;
      if (rule.effect === "confirm") confirmation = true;
      if (rule.effect === "allow") allowed = true;
    }
    const allows = set.rules.filter((rule) => rule.effect === "allow");
    if (
      (allows.length > 0 || set.strictAllowlist) &&
      !matches.some((rule) => rule.effect === "allow")
    ) {
      denied = true;
      reasons.push(`POLICY_ALLOWLIST_MISS:${set.id}`);
    }
  }
  const opaque = OPAQUE_PROGRAMS.has(action.program.split("/").at(-1)!);
  if (opaque && sets.some((set) => set.strictAllowlist)) {
    denied = true;
    reasons.push("OPAQUE_COMMAND_IN_STRICT_MODE");
  }
  return {
    outcome: denied
      ? "deny"
      : opaque
        ? "unknown"
        : confirmation || !allowed
          ? "confirm"
          : "allow",
    revision: snapshot.revision,
    matchedRules,
    reasons:
      opaque && !denied ? [...reasons, "COMMAND_NEEDS_MANUAL_REVIEW"] : reasons,
  };
}
