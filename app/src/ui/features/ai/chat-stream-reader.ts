/** A finite chat response, separate from persistent infrastructure SSE subscriptions. */
export async function* readChatEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("MODEL_STREAM_INTERRUPTED");
  const decoder = new TextDecoder();
  let bytes = 0,
    lines = 0,
    buffer = "",
    failure: Error | undefined;
  const stop = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  let idle: ReturnType<typeof setTimeout>;
  const timeout = () => {
    failure = Error("MODEL_RESPONSE_TIMEOUT");
    void reader.cancel(failure).catch(() => {});
  };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(timeout, 60000);
  };
  const total = setTimeout(timeout, 30 * 60000);
  signal.addEventListener("abort", stop, { once: true });
  resetIdle();
  try {
    if (signal.aborted) throw signal.reason;
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (failure) throw failure;
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
      resetIdle();
      buffer += decoder.decode(next.value, { stream: true });
      if (!response.ok) {
        if (buffer.length > 256 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
        continue;
      }
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index < 0) break;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (++lines > 65536 || line.length > 256 * 1024)
          throw Error("MODEL_RESPONSE_TOO_LARGE");
        if (!response.ok) continue;
        if (!line.startsWith("data:")) continue;
        let event: unknown;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          throw Error("MODEL_STREAM_INVALID");
        }
        if (!event || typeof event !== "object" || Array.isArray(event))
          throw Error("MODEL_STREAM_INVALID");
        yield event as Record<string, unknown>;
      }
      if (buffer.length > 256 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
    }
    if (!response.ok) {
      let message = "MODEL_REQUEST_FAILED";
      try {
        const parsed = JSON.parse(buffer);
        if (typeof parsed.error === "string") message = parsed.error;
      } catch {
        /* generic error */
      }
      throw Error(message);
    }
    if (buffer.trim()) throw Error("MODEL_STREAM_INTERRUPTED");
  } finally {
    clearTimeout(idle!);
    clearTimeout(total);
    signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
