import { AiProviderError } from "./types.js";

interface ResponseLimits {
  maxBytes: number;
  idleMs: number;
  totalMs: number;
}
const DEFAULT_LIMITS: ResponseLimits = {
  maxBytes: 8 * 1024 * 1024,
  idleMs: 60000,
  totalMs: 180000,
};
type FetchPort = (url: string, init: RequestInit) => Promise<Response>;

/** Provider-owned lifetime: one request, bounded body, no retry. */
export async function fetchBoundedResponse(
  fetcher: FetchPort,
  url: string,
  init: RequestInit,
  limits: ResponseLimits = DEFAULT_LIMITS,
): Promise<Response> {
  if (!Object.values(limits).every((n) => Number.isSafeInteger(n) && n > 0))
    throw Error("MODEL_RESPONSE_CONFIG_INVALID");
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finished = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(idle);
    clearTimeout(total);
    init.signal?.removeEventListener("abort", cancelled);
  };
  const release = () => {
    try {
      reader?.releaseLock();
    } catch {
      /* an in-flight read releases later */
    }
  };
  const stop = (reason: unknown) => {
    if (finished) return;
    finished = true;
    cleanup();
    abort.abort(reason);
    try {
      output?.error(reason);
    } catch {
      /* already cancelled */
    }
    if (reader)
      void reader
        .cancel(reason)
        .catch(() => {})
        .finally(release);
  };
  const cancelled = () =>
    stop(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
  const timeout = () => stop(new AiProviderError("MODEL_RESPONSE_TIMEOUT"));
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(timeout, limits.idleMs);
    idle.unref?.();
  };
  const total = setTimeout(timeout, limits.totalMs);
  total.unref?.();
  init.signal?.addEventListener("abort", cancelled, { once: true });
  if (init.signal?.aborted) cancelled();
  if (finished) throw abort.signal.reason;
  resetIdle();
  try {
    const response = await fetcher(url, { ...init, signal: abort.signal });
    if (abort.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw abort.signal.reason;
    }
    resetIdle();
    if (!response.body) {
      finished = true;
      cleanup();
      return response;
    }
    reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          output = controller;
        },
        async pull(controller) {
          if (finished) return;
          try {
            const next = await reader!.read();
            if (finished) return;
            if (next.done) {
              finished = true;
              cleanup();
              release();
              controller.close();
              return;
            }
            bytes += next.value.byteLength;
            if (bytes > limits.maxBytes) {
              stop(new AiProviderError("MODEL_RESPONSE_TOO_LARGE"));
              return;
            }
            resetIdle();
            controller.enqueue(next.value);
          } catch (error) {
            stop(error);
          } finally {
            if (finished) release();
          }
        },
        cancel(reason) {
          stop(reason ?? new DOMException("Cancelled", "AbortError"));
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    stop(error);
    throw abort.signal.aborted ? abort.signal.reason : error;
  }
}
