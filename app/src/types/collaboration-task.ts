import type { TaskPlanStep, TaskFileBindings } from "./task-plan.js";
import type { FileScope, FileResultView } from "./file-operations.js";
import type { ControlSnapshot } from "./collaboration.js";
import type {
  OperationAction,
  CommandDecision,
  CommandMatch,
} from "./collaboration-operations.js";

export interface CollaborationTarget {
  id: number;
  name: string;
  address: string;
  port: number;
  groups: string[];
}

export type TaskMode = "collaborative" | "automatic";
export type TaskState =
  | "awaiting-authorization"
  | "authorizing"
  | "ready"
  | "running"
  | "awaiting-approval"
  | "paused-human"
  | "paused-error"
  | "completed-with-errors"
  | "completed"
  | "cancelled";
export interface WorkflowReference {
  id: string;
  revision: number;
  version: string;
  shellState: "explicit-cwd" | "stateful-shell";
}
export interface TaskWorkflowRun {
  operationCount?: number;
  id: string;
  taskId: string;
  name: string;
  workflow: WorkflowReference;
  state: TaskState;
  nextStep: number;
  stepCount: number;
  operationIds: string[];
  createdAt: number;
  endedAt?: number;
  hasFailures?: boolean;
  error?: string;
}
export interface TaskCommand {
  stepId?: string;
  name?: string;
  timeoutMs?: number;
  onFailure?: "stop" | "continue";
  program: string;
  args: string[];
  cwd?: string;
}
export interface TaskOperation {
  outputTruncated?: boolean;
  id: string;
  requestId?: string;
  digest: string;
  action: OperationAction;
  fileResult?: FileResultView;
  decision: CommandDecision;
  status: string;
  output?: string;
  error?: string;
  exitCode?: number | null;
  resultingCwd?: string;
  auditGap?: boolean;
  startedAt?: number;
  endedAt?: number;
  timedOut?: boolean;
  interruptionRequested?: boolean;
  workflowRunId?: string;
  reviewed?: { decision: "skip" | "retry"; at: number };
}
export interface TaskViewOptions {
  operationLimit: number;
  operationOffset?: number;
}
export interface TaskOperationPage {
  offset: number;
  total: number;
  succeeded: number;
  previousOffset: number | null;
  nextOffset: number | null;
  latest?: { id: string; status: string; error?: string; auditGap?: boolean };
}
export interface TaskView {
  recovery?: {
    recordId: string;
    completedSteps: number;
  };
  canArchive?: boolean;
  operationPage?: TaskOperationPage;
  id: string;
  sessionId: string;
  hostId: number;
  hostName: string;
  title: string;
  source: "workflow" | "mcp" | "assistant";
  mode: TaskMode;
  state: TaskState;
  cwd?: string;
  nextStep: number;
  stepCount: number;
  commands: TaskCommand[];
  plan?: TaskPlanStep[];
  fileBindings?: TaskFileBindings;
  operations: TaskOperation[];
  error?: string;
  reconciliationRequired?: boolean;
  control: ControlSnapshot;
  policyRevision: number;
  createdAt: number;
  planRevision?: number;
  activeWorkflowRunId?: string;
  workflowRuns?: TaskWorkflowRun[];
  hasFailures?: boolean;
  workflow?: {
    id: string;
    revision: number;
    version: string;
    shellState: "explicit-cwd" | "stateful-shell";
  };
}
export interface TaskAuthorization {
  fileBindings?: TaskFileBindings;
  planRevision?: number;
  generation: number;
  controlEpoch: number;
  policyRevision: number;
  shellReady: boolean;
  directory?: string;
  maxOperations: number;
  durationMinutes: number;
  matches?: CommandMatch[];
  fileScopes?: FileScope[];
  allowReviewedPlan: boolean;
  reconciliation?: "retry" | "skip";
}
