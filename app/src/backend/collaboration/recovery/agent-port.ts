import type { TaskExecutionCheckpoint } from "../../../types/task-recovery.js";
import type { TaskView } from "../../../types/collaboration-task.js";
export interface RecoveredAgentTask {
  task: TaskView;
  activate(): void;
  cancel(): void;
}
export interface AgentTaskRecoveryPort {
  saveRecovery(
    userId: string,
    taskId: string,
    persist: (checkpoint: TaskExecutionCheckpoint) => Promise<void>,
  ): Promise<TaskExecutionCheckpoint>;
  prepareRecovery(
    userId: string,
    checkpoint: TaskExecutionCheckpoint,
    input: {
      sessionId: string;
      requestId: string;
      reconciliation?: "retry" | "skip";
    },
  ): Promise<RecoveredAgentTask>;
}
