import type { TaskMode } from "./collaboration-task.js";
export type AiTaskPhase =
  | "planning"
  | "awaiting-authorization"
  | "thinking"
  | "executing"
  | "awaiting-approval"
  | "awaiting-answer"
  | "paused-human"
  | "paused-error"
  | "completed-with-errors"
  | "completed"
  | "cancelled";
export interface AiTaskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "interrupted";
}
export interface AiTaskView {
  recoveredFrom?: { runId: string; taskId: string };
  id: string;
  taskId: string;
  sessionId: string;
  providerId: number;
  providerLabel: string;
  model: string;
  goal: string;
  mode: TaskMode;
  phase: AiTaskPhase;
  turns: number;
  maxTurns: number;
  messages: AiTaskMessage[];
  question?: { id: string; text: string };
  error?: string;
  createdAt: number;
}
export interface CreateAiTask {
  sessionId: string;
  requestId: string;
  providerId: number;
  model: string;
  goal: string;
  mode: TaskMode;
  maxTurns: number;
}
