import type { AiTaskView } from "./ai-task.js";
import type { ChatMessage } from "./ai-conversation.js";
export interface AiExecutionCheckpoint {
  schemaVersion: 1;
  providerIdentity: string;
  view: AiTaskView;
  history: Array<
    Array<Omit<ChatMessage, "role"> & { role: "user" | "assistant" | "tool" }>
  >;
  question?: { id: string; text: string; answer?: string };
  interruptedModel: boolean;
}
