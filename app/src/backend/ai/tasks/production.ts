import {
  directoryAutomation,
  fileAutomation,
  transferAutomation,
} from "../../collaboration/files/production.js";
import { createCurrentAiRepository } from "../../database/repositories/factory.js";
import {
  taskRuntime,
  journalFor,
} from "../../collaboration/tasks/production.js";
import { resolveAiAccess } from "../gating.js";
import { getAdapter } from "../providers/registry.js";
import {
  isAiProviderType,
  type ChatChunk,
  type ChatRequest,
} from "../providers/types.js";
import { redactString } from "../../privacy/redaction.js";
import { onAiAccessChanged } from "../access-events.js";
import { AiTaskCoordinator } from "./runner.js";
import { workflows } from "../../collaboration/workflows/production.js";
async function validate(userId: string, providerId: number, model: string) {
  if (!model.trim() || model.length > 256) throw new Error("MODEL_REQUIRED");
  if (!(await resolveAiAccess(userId)).enabled) throw new Error("AI_DISABLED");
  const provider = await createCurrentAiRepository().findProvider(
    providerId,
    userId,
  );
  if (
    !provider ||
    !provider.enabled ||
    !isAiProviderType(provider.providerType)
  )
    throw new Error("MODEL_PROVIDER_UNAVAILABLE");
  return { label: provider.label };
}
async function* stream(
  userId: string,
  providerId: number,
  request: ChatRequest,
): AsyncGenerator<ChatChunk> {
  await validate(userId, providerId, request.model);
  const provider = await createCurrentAiRepository().findProviderWithSecret(
    providerId,
    userId,
  );
  if (
    !provider ||
    !isAiProviderType(provider.providerType) ||
    !provider.enabled
  )
    throw new Error("MODEL_PROVIDER_UNAVAILABLE");
  if (request.signal?.aborted) throw new Error("AGENT_CONTEXT_CHANGED");
  const config = {
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  };
  const secret = config.apiKey ?? "";
  let pending = "";
  const scrub = (text: string) =>
    redactString(secret ? text.replaceAll(secret, "[redacted]") : text);
  try {
    for await (const chunk of getAdapter(config.providerType).streamChat(
      config,
      request,
    )) {
      if (request.signal?.aborted) throw new Error("AGENT_CONTEXT_CHANGED");
      if (chunk.type === "text") {
        pending += chunk.text;
        let cut = Math.max(0, pending.length - Math.max(0, secret.length - 1));
        if (secret) {
          let start = pending.indexOf(secret);
          while (start >= 0) {
            if (start < cut && start + secret.length > cut) cut = start;
            start = pending.indexOf(secret, start + 1);
          }
        }
        if (cut) {
          yield { type: "text", text: scrub(pending.slice(0, cut)) };
          pending = pending.slice(cut);
        }
      } else if (chunk.type === "tool_call") {
        if (secret && JSON.stringify(chunk.call.arguments).includes(secret))
          throw new Error("MODEL_SENSITIVE_OUTPUT");
        yield chunk;
      } else if (chunk.type === "error")
        throw new Error("MODEL_REQUEST_FAILED");
      else yield chunk;
    }
    if (pending) yield { type: "text", text: scrub(pending) };
  } catch (error) {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))
      throw error;
    throw new Error("MODEL_REQUEST_FAILED");
  } finally {
    config.apiKey = null;
  }
}
export const aiTasks = new AiTaskCoordinator({
  directories: directoryAutomation,
  files: fileAutomation,
  transfers: transferAutomation,
  tasks: taskRuntime,
  workflows,
  validate,
  stream,
  audit: (userId, type, data) => journalFor(userId).record(type, data),
});
onAiAccessChanged((change) =>
  aiTasks.setEnabled(change.enabled, change.userId),
);
