import type { FileAction, FileRule } from "./file-operations.js";
export type OperationAction = CommandAction | FileAction;
export interface CommandAction {
  type: "terminal.command";
  program: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

export type CommandMatch =
  | { kind: "program"; program: string }
  | { kind: "program-args"; program: string; args: string[] };

export interface CommandRule {
  id: string;
  effect: "allow" | "confirm" | "deny";
  match: CommandMatch;
  reason: string;
}

export interface CommandPolicySet {
  id: string;
  scope: { type: "global" } | { type: "group" | "host" | "task"; id: string };
  strictAllowlist: boolean;
  strictFileAllowlist?: boolean;
  fileRules?: FileRule[];
  rules: CommandRule[];
}

export interface CommandPolicySnapshot {
  revision: number;
  sets: CommandPolicySet[];
}

export interface PolicyTarget {
  hostId: string;
  groupIds: string[];
  taskId: string;
}

export interface CommandDecision {
  outcome: "allow" | "confirm" | "deny" | "unknown";
  revision: number;
  matchedRules: string[];
  reasons: string[];
}
