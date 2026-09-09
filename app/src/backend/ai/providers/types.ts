/**
 * The shape every provider adapter normalizes to. Adding a provider means
 * translating its wire format into these events; nothing downstream (the
 * engine, the tool dispatcher, the SSE route) knows which vendor is in use.
 */

export type AiProviderType =
  "ollama" | "anthropic" | "openai" | "gemini" | "openai_compatible";

export const AI_PROVIDER_TYPES: AiProviderType[] = [
  "ollama",
  "anthropic",
  "openai",
  "gemini",
  "openai_compatible",
];

export function isAiProviderType(value: unknown): value is AiProviderType {
  return (
    typeof value === "string" && (AI_PROVIDER_TYPES as string[]).includes(value)
  );
}

import type { ChatMessage, ToolCall } from "../../../types/ai-conversation.js";
export type { ChatMessage, ToolCall } from "../../../types/ai-conversation.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  expectedProviderIdentity?: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string };

export interface ProviderConfig {
  providerType: AiProviderType;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface ProviderAdapter {
  /** Streams a single assistant turn. Tool execution happens in the engine. */
  streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk>;
  /** Model ids to offer in the picker, best effort. */
  listModels(config: ProviderConfig): Promise<string[]>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
