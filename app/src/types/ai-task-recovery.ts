import type { AiTaskView } from "./ai-task.js";
import type { ChatMessage } from "./ai-conversation.js";
export interface AiExecutionCheckpoint {
  waitingWorkflow?: { id: string; callId?: string };
  schemaVersion: 1;
  providerIdentity: string;
  view: AiTaskView;
  history: Array<
    Array<Omit<ChatMessage, "role"> & { role: "user" | "assistant" | "tool" }>
  >;
  context?: Array<
    Pick<ChatMessage, "role" | "content"> & { role: "user" | "assistant" }
  >;
  question?: { id: string; text: string; answer?: string };
  interruptedModel: boolean;
}
