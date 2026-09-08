import type { TaskCommand, TaskMode } from "./collaboration-task.js";
export type MacroStep =
  | { id: string; type: "send"; text: string; pressEnter: boolean }
  | { id: string; type: "delay"; milliseconds: number }
  | {
      id: string;
      type: "wait";
      pattern: string;
      isRegex?: boolean;
      flags?: string;
      timeoutMs: number;
      onTimeout: "stop" | "continue";
    }
  | {
      id: string;
      type: "if";
      pattern: string;
      isRegex?: boolean;
      flags?: string;
      then: MacroStep[];
      else: MacroStep[];
    }
  | { id: string; type: "repeat"; count: number; steps: MacroStep[] };

export interface TerminalMacro {
  id: string;
  name: string;
  description?: string;
  steps: MacroStep[];
  createdAt: string;
  updatedAt: string;
}

export type LegacyCommandRequest =
  | {
      kind: "snippet";
      title: string;
      content: string;
      inputs?: Record<string, string>;
    }
  | { kind: "macro"; title: string; steps: MacroStep[] };
export interface LegacyTaskRequest {
  sessionId: string;
  requestId: string;
  mode?: TaskMode;
  source: LegacyCommandRequest;
}
export interface LegacyCompilation {
  commands: TaskCommand[];
  notes: string[];
}
