import { getErrorMessage } from "../../lib/error-message.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { authApi, isElectron } from "@/main-axios";
import type { AiProposal } from "@/api/ai-api";
import { readChatEvents } from "./chat-stream-reader.js";
function streamUrl(): string {
  const base = (authApi.defaults.baseURL ?? "").replace(/\/+$/, "");
  return `${base}/ai/chat/stream`;
}
export interface ToolActivity {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}
export interface StreamState {
  streaming: boolean;
  assistantText: string;
  tools: ToolActivity[];
  proposals: AiProposal[];
  error: string | null;
  conversationId: number | null;
}
const INITIAL: StreamState = {
  streaming: false,
  assistantText: "",
  tools: [],
  proposals: [],
  error: null,
  conversationId: null,
};
export function useAiStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    const old = abortRef.current;
    abortRef.current = null;
    old?.abort();
  }, []);
  useEffect(() => cancel, [cancel]);
  const reset = useCallback(() => {
    cancel();
    setState(INITIAL);
  }, [cancel]);
  const stop = useCallback(() => {
    cancel();
    setState((prev) => ({ ...prev, streaming: false }));
  }, [cancel]);
  const send = useCallback(
    async (input: {
      message: string;
      providerId: number;
      model?: string;
      conversationId?: number | null;
      activeTab?: string | null;
      onComplete?: (conversationId: number | null, reply: string) => void;
    }) => {
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;
      const current = () => abortRef.current === controller;
      let view: StreamState = {
        ...INITIAL,
        streaming: true,
        conversationId: input.conversationId ?? null,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const publish = () => {
        clearTimeout(timer);
        timer = undefined;
        const snapshot = view;
        if (current()) setState((prev) => (current() ? snapshot : prev));
      };
      const schedule = () => {
        if (!timer) timer = setTimeout(publish, 20);
      };
      publish();
      let sequence = 0,
        textBytes = 0,
        done = false;
      const encoder = new TextEncoder();
      try {
        const headers = new Headers({ "Content-Type": "application/json" });
        if (isElectron()) {
          headers.set("X-Electron-App", "true");
          const jwt = localStorage.getItem("jwt");
          if (jwt) headers.set("Authorization", `Bearer ${jwt}`);
        }
        const response = await fetch(streamUrl(), {
          method: "POST",
          headers,
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            message: input.message,
            providerId: input.providerId,
            model: input.model,
            conversationId: input.conversationId ?? undefined,
            activeTab: input.activeTab ?? undefined,
          }),
        });
        if (!current()) {
          void response.body?.cancel().catch(() => {});
          return;
        }
        for await (const event of readChatEvents(response, controller.signal)) {
          if (!current()) return;
          if (event.type === "conversation") {
            if (!Number.isSafeInteger(event.conversationId))
              throw Error("MODEL_STREAM_INVALID");
            view = { ...view, conversationId: event.conversationId as number };
          } else if (event.type === "token") {
            if (typeof event.text !== "string")
              throw Error("MODEL_STREAM_INVALID");
            textBytes += encoder.encode(event.text).byteLength;
            if (textBytes > 128 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
            view = { ...view, assistantText: view.assistantText + event.text };
          } else if (event.type === "tool_call") {
            if (view.tools.length >= 64) throw Error("MODEL_TOOL_LIMIT");
            if (typeof event.name !== "string")
              throw Error("MODEL_STREAM_INVALID");
            view = {
              ...view,
              tools: [
                ...view.tools,
                {
                  id: `tool-${sequence++}`,
                  name: event.name,
                  arguments: (event.arguments ?? {}) as Record<string, unknown>,
                },
              ],
            };
          } else if (event.type === "tool_result") {
            const tools = [...view.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].name === event.name && !("result" in tools[i])) {
                tools[i] = { ...tools[i], result: event.result };
                break;
              }
            }
            view = { ...view, tools };
          } else if (event.type === "proposal") {
            if (view.proposals.length >= 64) throw Error("MODEL_TOOL_LIMIT");
            view = {
              ...view,
              proposals: [...view.proposals, event.proposal as AiProposal],
            };
          } else if (event.type === "error") {
            throw Error(
              typeof event.message === "string"
                ? event.message
                : "MODEL_REQUEST_FAILED",
            );
          } else if (event.type === "done") done = true;
          schedule();
        }
        if (!current()) return;
        if (!done) throw Error("MODEL_STREAM_INTERRUPTED");
        view = { ...view, streaming: false };
        publish();
        input.onComplete?.(view.conversationId, view.assistantText);
      } catch (error) {
        if (current()) {
          view = {
            ...view,
            streaming: false,
            error: getErrorMessage(error, "MODEL_REQUEST_FAILED"),
          };
          publish();
        }
      } finally {
        clearTimeout(timer);
        // Do not clear a newer request's identity. Scheduled React updaters still
        // need this completed request's identity until it is replaced or stopped.
        controller.abort();
      }
    },
    [cancel],
  );
  return { state, send, stop, reset, setState };
}
