import type { TaskPlanStep, TaskFileBindings } from "./task-plan.js";
import type { TaskCommand } from "./collaboration-task.js";
export type WorkflowParameter =
  | {
      type: "string";
      required?: boolean;
      default?: string;
      minLength?: number;
      maxLength?: number;
      description?: string;
    }
  | {
      type: "remote-directory" | "remote-path";
      required?: boolean;
      default?: string;
      description?: string;
    }
  | {
      type: "integer";
      required?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
    }
  | {
      type: "boolean";
      required?: boolean;
      default?: boolean;
      description?: string;
    }
  | {
      type: "enum";
      required?: boolean;
      default?: string;
      values: string[];
      description?: string;
    }
  | { type: "secret-ref"; required?: boolean; description?: string };
export type WorkflowValue = string | { param: string };
export type WorkflowArgument =
  WorkflowValue | { param: string; whenTrue: string[]; whenFalse: string[] };
export type WorkflowFileAction = {
  path: WorkflowValue;
  localFile: string;
  overwrite?: boolean;
} & (
  | { type: "upload" }
  | { type: "download" }
  | {
      type: "upload-directory";
      onConflict?: "fail" | "skip" | "overwrite";
    }
  | { type: "download-directory"; onConflict?: "fail" | "skip" | "overwrite" }
);
export interface WorkflowDefinition {
  schemaVersion: 1 | 2 | 3;
  files?: Record<
    string,
    {
      direction: "upload" | "download";
      kind?: "directory";
      description?: string;
    }
  >;
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  shellState?: "explicit-cwd" | "stateful-shell";
  parameters: Record<string, WorkflowParameter>;
  defaults: {
    cwd?: WorkflowValue;
    timeoutMs?: number;
    onFailure?: "stop" | "continue";
    retry?: { maxAttempts: 1 };
    env?: Record<string, WorkflowValue>;
  };
  steps: Array<{
    id: string;
    name: string;
    cwd?: WorkflowValue;
    timeoutMs?: number;
    onFailure?: "stop" | "continue";
    action:
      | WorkflowFileAction
      | { type: "command"; program: string; args: WorkflowArgument[] }
      | {
          type: "script";
          shell: "sh" | "bash";
          source: string;
          args?: WorkflowArgument[];
        };
  }>;
}
export interface SavedWorkflow {
  needsHostBinding?: boolean;
  id: string;
  revision: number;
  definition: WorkflowDefinition;
  allowedHostIds: number[];
  updatedAt: number;
}
export interface WorkflowPreview {
  id: string;
  workflowId: string;
  revision: number;
  definitionVersion: string;
  sessionId: string;
  hostId: number;
  policyRevision: number;
  parentTaskId?: string;
  commands: TaskCommand[];
  plan?: TaskPlanStep[];
  fileBindings?: TaskFileBindings;
  warnings: string[];
  expiresAt: number;
}

export function isWorkflowFileAction(
  action: WorkflowDefinition["steps"][number]["action"],
): action is WorkflowFileAction {
  return (
    action.type === "upload" ||
    action.type === "download" ||
    action.type === "upload-directory" ||
    action.type === "download-directory"
  );
}
