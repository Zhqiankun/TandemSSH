import type { TaskCommand } from "./collaboration-task.js";
export interface TaskFileStep {
  kind: "file-transfer" | "directory-transfer";
  onConflict?: "fail" | "skip" | "overwrite";
  stepId: string;
  name: string;
  direction: "upload" | "download";
  path: string;
  localFile: string;
  overwrite: boolean;
  timeoutMs?: number;
  onFailure?: "stop" | "continue";
}
export type TaskPlanStep = TaskCommand | TaskFileStep;
export type TaskFileBindings = Record<
  string,
  { localGrantId: string; localVersion: string }
>;
export function isTaskFileStep(step: TaskPlanStep): step is TaskFileStep {
  return (
    "kind" in step &&
    (step.kind === "file-transfer" || step.kind === "directory-transfer")
  );
}
