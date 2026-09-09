export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** Set on tool turns, matching the id of the call being answered. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Opaque provider state that has to be echoed back verbatim on the next
   * turn. Gemini 2.5+ rejects a follow-up whose functionCall parts have lost
   * their thoughtSignature, so this rides along rather than being dropped.
   */
  providerSignature?: string;
}
