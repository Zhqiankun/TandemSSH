import { getErrorMessage } from "../utils/error-message.js";
import { getAdapter } from "./providers/registry.js";
import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
} from "./providers/types.js";
import { redact, redactToJson } from "./redaction.js";
import { getTool, toolDefinitions } from "./tools/catalog.js";
import {
  isProposalDraft,
  type ProposalDraft,
  type ToolContext,
} from "./tools/types.js";

/**
 * The agent loop: stream a turn, run any tools the model asked for, feed the
 * results back, repeat. Bounded so a model that keeps calling tools cannot spin
 * forever.
 */

const MAX_TURNS = 8;
function assertSize(value: unknown, maximum: number, code: string): void {
  if (Buffer.byteLength(JSON.stringify(value) ?? "null") > maximum)
    throw Error(code);
}

export type EngineEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "proposal"; draft: ProposalDraft }
  | { type: "assistant_message"; content: string; toolCalls: ToolCall[] }
  | { type: "done" }
  | { type: "error"; message: string };

export interface EngineOptions {
  config: ProviderConfig;
  model: string;
  system: string;
  history: ChatMessage[];
  context: ToolContext;
  signal?: AbortSignal;
}

export async function* runAgent(
  options: EngineOptions,
): AsyncGenerator<EngineEvent> {
  const adapter = getAdapter(options.config.providerType);
  const tools = toolDefinitions();
  const messages: ChatMessage[] = [...options.history];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      options.signal?.throwIfAborted();
      assertSize(
        { system: options.system, messages },
        128 * 1024,
        "MODEL_CONTEXT_LIMIT",
      );
      let textBytes = 0,
        callBytes = 0;
      let text = "";
      const calls: ToolCall[] = [];
      let failed = false;

      try {
        for await (const chunk of adapter.streamChat(options.config, {
          model: options.model,
          system: options.system,
          messages,
          tools,
          signal: options.signal,
        })) {
          if (chunk.type === "text") {
            textBytes += Buffer.byteLength(chunk.text);
            if (textBytes > 16 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
            text += chunk.text;
            yield { type: "token", text: chunk.text };
          } else if (chunk.type === "tool_call") {
            callBytes += Buffer.byteLength(JSON.stringify(chunk.call));
            if (calls.length >= 8 || callBytes > 64 * 1024)
              throw Error("MODEL_TOOL_LIMIT");
            calls.push(chunk.call);
          } else if (chunk.type === "error") {
            failed = true;
            yield { type: "error", message: chunk.message };
          }
        }
      } catch (error) {
        const message = getErrorMessage(error, "The provider request failed");
        yield { type: "error", message };
        return;
      }

      if (failed) return;
      options.signal?.throwIfAborted();

      yield { type: "assistant_message", content: text, toolCalls: calls };

      if (!calls.length) {
        yield { type: "done" };
        return;
      }

      messages.push({ role: "assistant", content: text, toolCalls: calls });

      assertSize(
        { system: options.system, messages },
        128 * 1024,
        "MODEL_CONTEXT_LIMIT",
      );
      for (const call of calls) {
        options.signal?.throwIfAborted();
        yield { type: "tool_call", name: call.name, arguments: call.arguments };

        options.signal?.throwIfAborted();
        const result = await runTool(call, options.context);
        options.signal?.throwIfAborted();
        assertSize(result, 64 * 1024, "MODEL_TOOL_RESULT_LIMIT");

        if (isProposalDraft(result)) {
          // Closes the tool call before the proposal card is emitted. Without
          // this the call has no matching result and renders as permanently
          // running, even though the work is done and awaiting the user.
          yield {
            type: "tool_result",
            name: call.name,
            result: { status: "awaiting_user_approval" },
          };
          yield { type: "proposal", draft: result };
          // The model is told the proposal is awaiting the user rather than done,
          // so it does not go on to describe the change as applied.
          messages.push({
            role: "tool",
            content: JSON.stringify({
              status: "awaiting_user_approval",
              summary: result.summary,
            }),
            toolCallId: call.id,
            toolName: call.name,
          });
          continue;
        }

        yield { type: "tool_result", name: call.name, result: redact(result) };
        messages.push({
          role: "tool",
          content: redactToJson(result),
          toolCallId: call.id,
          toolName: call.name,
        });
      }
    }
  } catch (error) {
    yield {
      type: "error",
      message: getErrorMessage(error, "MODEL_REQUEST_FAILED"),
    };
    return;
  }

  // Ran out of turns with the model still calling tools.
  yield {
    type: "error",
    message: "The assistant used too many steps without finishing.",
  };
}

async function runTool(call: ToolCall, context: ToolContext): Promise<unknown> {
  const tool = getTool(call.name);

  // A model can emit any name it likes; only the catalog decides what runs.
  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    return await tool.handler(call.arguments ?? {}, context);
  } catch (error) {
    return {
      error: getErrorMessage(error, "The tool failed"),
    };
  }
}
