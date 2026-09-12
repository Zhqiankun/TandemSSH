import { z } from "zod";
import type { ChatMessage } from "./providers/types.js";
const call = z
  .object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    providerSignature: z.string().optional(),
  })
  .strict();
const message = z
  .object({
    role: z.enum(["assistant", "tool"]),
    content: z.string(),
    toolCalls: z.array(call).optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })
  .strict();
const envelope = z
  .object({ version: z.literal(1), messages: z.array(message).max(80) })
  .strict();
/** Owned by ordinary chat persistence; this field remains opaque to the UI. */
export function encodeChatTurn(messages: ChatMessage[]): string {
  return JSON.stringify(envelope.parse({ version: 1, messages }));
}
export function restoreChatHistory(
  rows: Array<{ role: string; content: string; toolCalls: string | null }>,
): ChatMessage[] {
  return rows.flatMap((row): ChatMessage[] => {
    if (!row.toolCalls)
      return [
        {
          role: z.enum(["system", "user", "assistant", "tool"]).parse(row.role),
          content: row.content,
        },
      ];
    const stored: unknown = JSON.parse(row.toolCalls);
    if (Array.isArray(stored))
      return [
        {
          role: "assistant",
          content: row.content,
          toolCalls: z.array(call).parse(stored),
        },
      ];
    if (row.role !== "assistant") throw Error("CHAT_HISTORY_INVALID");
    return envelope.parse(stored).messages;
  });
}
