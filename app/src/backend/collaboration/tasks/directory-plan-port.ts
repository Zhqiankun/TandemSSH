import type { DirectoryStepCheckpoint } from "../../../types/directory-step-recovery.js";
import type {
  TaskFileStep,
  TaskFileBindings,
} from "../../../types/task-plan.js";
import type { DirectoryAction } from "../../../types/directory-transfer.js";
import type { OperationView } from "../operations/gateway.js";
export interface DirectoryStepCursor {
  checkpoint?(): DirectoryStepCheckpoint | undefined;
  readonly done: boolean;
  readonly requestIndex: number;
  readonly canRestart: boolean;
  readonly previewId?: string;
  matchesBinding(binding: TaskFileBindings[string] | undefined): boolean;
  next(): DirectoryAction | undefined;
  accept(operation: OperationView): void;
  close(): void;
}
export interface DirectoryStepPort {
  validate(
    userId: string,
    taskId: string,
    step: TaskFileStep,
    bindings: TaskFileBindings,
  ): void;
  open(
    userId: string,
    taskId: string,
    step: TaskFileStep,
    bindings: TaskFileBindings,
    recovery?: DirectoryStepCheckpoint,
  ): DirectoryStepCursor;
}
