import type { DirectoryStepCheckpoint } from "./directory-step-recovery.js";
import type { AiExecutionCheckpoint } from "./ai-task-recovery.js";
import type {
  TaskMode,
  TaskOperation,
  WorkflowReference,
  TaskWorkflowRun,
} from "./collaboration-task.js";
import type { TaskPlanStep } from "./task-plan.js";
export interface WorkflowExecutionCheckpoint {
  initialPlan: { steps: TaskPlanStep[]; workflow?: WorkflowReference };
  activeRunId?: string;
  runs: Array<{ summary: TaskWorkflowRun; steps: TaskPlanStep[] }>;
}
export interface TaskExecutionCheckpoint {
  directoryState?: DirectoryStepCheckpoint;
  completed?: boolean;
  workflowState?: WorkflowExecutionCheckpoint;
  workflowCwd?: string;
  ai?: AiExecutionCheckpoint;
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
  directoryProgress?: {
    direction?: "upload" | "download";
    completed: number;
    entries: number;
  };
  activeWorkflowName?: string;
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
  state: "available" | "claimed" | "interrupted" | "consumed" | "completed";
  savedAt: number;
}
export interface TaskRecoveryDetail {
  workflowRuns?: TaskWorkflowRun[];
  activeWorkflowRunId?: string;
  ai?: AiExecutionCheckpoint["view"];
  summary: TaskRecoverySummary;
  steps: TaskPlanStep[];
  operations: TaskOperation[];
  cwd?: string;
}
