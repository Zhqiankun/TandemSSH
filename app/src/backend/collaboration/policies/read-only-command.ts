import type { CommandAction } from "../../../types/collaboration-operations.js";

/**
 * Commands eligible for a task-scoped, read-only auto-run grant.
 *
 * This is an execution boundary, not a UI hint. Callers must still enforce the
 * current command policy, task lease, cwd scope, expiry and operation budget.
 */
export const READ_ONLY_COMMANDS = new Set([
  "df",
  "du",
  "free",
  "uptime",
  "uname",
  "whoami",
  "hostname",
  "id",
  "ps",
  "systemctl",
  "journalctl",
  "docker",
  "ip",
  "ss",
  "netstat",
  "lsblk",
  "cat",
  "ls",
  "stat",
  "which",
  "date",
  "lscpu",
  "vmstat",
  "iostat",
]);

const SHELL_METACHARACTERS = /[;&|`$><\n\r\\]/;

const SUBCOMMAND_ALLOWLIST: Record<string, Set<string>> = {
  systemctl: new Set([
    "status",
    "list-units",
    "list-unit-files",
    "list-sockets",
    "is-active",
    "is-enabled",
    "show",
    "cat",
  ]),
  docker: new Set([
    "ps",
    "stats",
    "images",
    "logs",
    "inspect",
    "version",
    "info",
  ]),
  ip: new Set(["a", "addr", "address", "link", "route", "neigh", "neighbor"]),
};

const CAT_ALLOWED_PREFIXES = ["/proc/", "/sys/", "/etc/os-release"];
const HOSTNAME_READ_ARGS = new Set([
  "-a",
  "--alias",
  "-d",
  "--domain",
  "-f",
  "--fqdn",
  "--long",
  "-i",
  "--ip-address",
  "-I",
  "--all-ip-addresses",
  "-s",
  "--short",
  "-y",
  "--yp",
  "--nis",
  "--help",
  "--version",
]);
const IP_MUTATIONS = new Set([
  "add",
  "append",
  "change",
  "delete",
  "del",
  "flush",
  "replace",
  "set",
]);

export interface CommandCheck {
  allowed: boolean;
  reason?: string;
}

type ReadOnlyCommand = Pick<CommandAction, "program" | "args">;

function executableName(program: string) {
  return program.trim().split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
}

function denied(reason: string): CommandCheck {
  return { allowed: false, reason };
}

export function isReadOnlyCommandAction(action: ReadOnlyCommand): CommandCheck {
  const binary = executableName(action.program);
  if (!binary) return denied("Empty command");
  if (["sudo", "su", "doas", "env"].includes(binary))
    return denied(`${binary} is not allowed`);
  if (!READ_ONLY_COMMANDS.has(binary))
    return denied(`${binary} is not on the read-only allowlist`);

  const args = action.args;
  const allowedSubcommands = SUBCOMMAND_ALLOWLIST[binary];
  const subcommand = allowedSubcommands
    ? args.find((part) => !part.startsWith("-"))
    : undefined;
  if (
    allowedSubcommands &&
    (!subcommand || !allowedSubcommands.has(subcommand))
  )
    return denied(
      `${binary} ${subcommand ?? ""}`.trim() +
        " is not on the read-only allowlist",
    );

  if (
    binary === "docker" &&
    subcommand === "stats" &&
    !args.includes("--no-stream")
  )
    return denied("docker stats must use --no-stream");
  if (
    binary === "docker" &&
    subcommand === "logs" &&
    args.some((part) => part === "-f" || part === "--follow")
  )
    return denied("docker logs cannot follow output");
  if (
    binary === "ip" &&
    args.some((part) => IP_MUTATIONS.has(part.toLowerCase()))
  )
    return denied("ip mutation is not allowed");
  if (
    binary === "journalctl" &&
    args.some(
      (part) =>
        part === "--rotate" ||
        part === "--flush" ||
        part === "--sync" ||
        part.startsWith("--vacuum"),
    )
  )
    return denied("journalctl maintenance is not allowed");

  if (
    binary === "hostname" &&
    args.some((part) => !HOSTNAME_READ_ARGS.has(part))
  )
    return denied("hostname arguments could change system state");

  if (binary === "date") {
    for (let index = 0; index < args.length; index++) {
      const part = args[index];
      if (part === "-s" || part === "--set" || part.startsWith("--set="))
        return denied("date setting is not allowed");
      if (part === "-d" || part === "--date") {
        index++;
        if (index >= args.length) return denied("date option needs a value");
        continue;
      }
      if (
        part.startsWith("--date=") ||
        part.startsWith("+") ||
        part.startsWith("-")
      )
        continue;
      return denied("date operands could change system state");
    }
  }

  if (binary === "cat") {
    const targets = args.filter((part) => !part.startsWith("-"));
    if (!targets.length) return denied("cat needs a file path");
    for (const target of targets) {
      const permitted = CAT_ALLOWED_PREFIXES.some((prefix) =>
        prefix.endsWith("/") ? target.startsWith(prefix) : target === prefix,
      );
      if (!permitted)
        return denied(`cat is limited to ${CAT_ALLOWED_PREFIXES.join(", ")}`);
    }
  }

  return { allowed: true };
}

/**
 * Compatibility parser for text command callers and tests. Production AI
 * execution uses structured argv and calls isReadOnlyCommandAction directly.
 */
export function isReadOnlyCommand(raw: string): CommandCheck {
  const command = raw.trim();
  if (!command) return denied("Empty command");
  if (SHELL_METACHARACTERS.test(command))
    return denied(
      "Command chaining, redirection and substitution are not allowed",
    );
  const parts = command.split(/\s+/).filter(Boolean);
  if (!parts.length) return denied("Empty command");
  return isReadOnlyCommandAction({ program: parts[0], args: parts.slice(1) });
}
