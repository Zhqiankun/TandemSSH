import { useEffect, useRef } from "react";
import { mcpApi } from "@/api/mcp-api";
/** AppShell supplies its existing openTab callback. This feature never opens
 * SSH itself and never loads a password or private key into a model prompt. */
export function useMcpSessionRequests(
  enabled: boolean,
  onOpen: (hostId: number, instanceId: string) => void,
) {
  const callback = useRef(onOpen);
  callback.current = onOpen;
  const consumer = useRef(crypto.randomUUID()),
    opened = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const requests = await mcpApi.requests(abort.signal);
        for (const request of requests) {
          if (stopped) return;
          if (opened.current.has(request.id)) continue;
          try {
            await mcpApi.claim(request.id, consumer.current);
          } catch {
            continue;
          }
          if (stopped) return;
          try {
            callback.current(request.hostId, request.id);
            opened.current.add(request.id);
          } catch {
            await mcpApi.fail(request.id).catch(() => {});
          }
        }
      } catch {
        /* Connection status is visible in MCP settings. Poll without duplicate toasts. */
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [enabled]);
}
