import type {
  TaskMode,
  TaskOperation,
  WorkflowReference,
} from "./collaboration-task.js";
import type { TaskPlanStep } from "./task-plan.js";
export interface TaskExecutionCheckpoint {
  schemaVersion: 1;
  id: string;
  userId: string;
  host: { id: number; name: string; peer: string };
  title: string;
  source: "workflow" | "mcp" | "assistant";
  clientId?: string;
  mode: TaskMode;
  steps: TaskPlanStep[];
  nextStep: number;
  workflow?: WorkflowReference;
  cwd?: string;
  hasFailures: boolean;
  resourceRecoveryRequired: boolean;
  reconciliationRequired: boolean;
  operations: TaskOperation[];
  createdAt: number;
  savedAt: number;
}
export interface TaskRecoverySummary {
  resourceRecoveryRequired: boolean;
  id: string;
  title: string;
  hostId: number;
  hostName: string;
  source: TaskExecutionCheckpoint["source"];
  mode: TaskMode;
  nextStep: number;
  stepCount: number;
  reconciliationRequired: boolean;
  state: "available" | "claimed" | "interrupted" | "consumed";
  savedAt: number;
}
export interface TaskRecoveryDetail {
  summary: TaskRecoverySummary;
  steps: TaskPlanStep[];
  operations: TaskOperation[];
  cwd?: string;
}
