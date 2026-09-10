import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/main-axios", () => ({
  authApi: { defaults: { baseURL: "http://fixture" } },
  isElectron: vi.fn(() => false),
}));
import { isElectron } from "@/main-axios";
import { useAiStream } from "@/features/ai/use-ai-stream";
function stream() {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        source = c;
      },
      cancel,
    }),
  );
  return {
    response,
    cancel,
    event: (value: unknown) =>
      source.enqueue(
        new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n"),
      ),
    close: () => source.close(),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("jwt");
  vi.mocked(isElectron).mockReturnValue(false);
});
const input = { message: "test", providerId: 1 };
it("a late old fetch rejection cannot end or detach the new request", async () => {
  let rejectOld!: (error: Error) => void;
  const old = new Promise<Response>((_resolve, reject) => {
    rejectOld = reject;
  });
  const next = stream();
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(next.response);
  const { result } = renderHook(() => useAiStream());
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = result.current.send(input);
  });
  act(() => {
    second = result.current.send(input);
  });
  await act(async () => {
    rejectOld(Error("old error"));
    await first;
  });
  expect(result.current.state.streaming).toBe(true);
  expect(result.current.state.error).toBeNull();
  const signal = mock.mock.calls[1][1]?.signal;
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    next.event({ type: "token", text: "新的中文" });
  });
  await waitFor(() =>
    expect(result.current.state.assistantText).toBe("新的中文"),
  );
  act(() => result.current.stop());
  await act(async () => {
    await second;
  });
  expect(signal?.aborted).toBe(true);
  expect(next.cancel).toHaveBeenCalledOnce();
  expect(result.current.state.streaming).toBe(false);
});
it("only a complete response calls onComplete and keeps its final batched text", async () => {
  const body = stream(),
    onComplete = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(body.response);
  const { result } = renderHook(() => useAiStream());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.send({ ...input, onComplete });
  });
  await act(async () => {
    body.event({ type: "conversation", conversationId: 7 });
    body.event({ type: "token", text: "完成" });
    body.event({ type: "done" });
    body.close();
    await pending;
  });
  expect(result.current.state).toMatchObject({
    streaming: false,
    assistantText: "完成",
    conversationId: 7,
    error: null,
  });
  expect(onComplete).toHaveBeenCalledExactlyOnceWith(7, "完成");
});
it.each(["error", "missing-done"])(
  "retains partial text without reporting completion after %s",
  async (kind) => {
    const body = stream(),
      onComplete = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(body.response);
    const { result } = renderHook(() => useAiStream());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.send({ ...input, onComplete });
    });
    await act(async () => {
      body.event({ type: "token", text: "片段" });
      if (kind === "error")
        body.event({ type: "error", message: "MODEL_CONTEXT_LIMIT" });
      body.close();
      await pending;
    });
    expect(result.current.state.assistantText).toBe("片段");
    expect(result.current.state.error).toBe(
      kind === "error" ? "MODEL_CONTEXT_LIMIT" : "MODEL_STREAM_INTERRUPTED",
    );
    expect(onComplete).not.toHaveBeenCalled();
  },
);
it.each(["reset", "unmount"])("cancels the reader on %s", async (action) => {
  const body = stream();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(body.response);
  const { result, unmount } = renderHook(() => useAiStream());
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.send(input);
  });
  act(() => {
    if (action === "reset") result.current.reset();
    else unmount();
  });
  await act(async () => {
    await pending;
  });
  expect(body.cancel).toHaveBeenCalledOnce();
  if (action === "reset")
    expect(result.current.state).toMatchObject({
      streaming: false,
      assistantText: "",
      error: null,
    });
});
it("bounds cumulative text and cancels the response before accepting the overflow", async () => {
  const body = stream(),
    onComplete = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(body.response);
  const { result } = renderHook(() => useAiStream());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.send({ ...input, onComplete });
  });
  await act(async () => {
    body.event({ type: "token", text: "x".repeat(128 * 1024) });
    body.event({ type: "token", text: "overflow" });
    await pending;
  });
  expect(result.current.state.assistantText.length).toBe(128 * 1024);
  expect(result.current.state.error).toBe("MODEL_RESPONSE_TOO_LARGE");
  expect(onComplete).not.toHaveBeenCalled();
  expect(body.cancel).toHaveBeenCalledOnce();
});

it("uses the existing Electron bearer authentication for chat streams", async () => {
  vi.mocked(isElectron).mockReturnValue(true);
  localStorage.setItem("jwt", "isolated-token");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response('data: {"type":"done"}\n\n'));
  const { result } = renderHook(() => useAiStream());
  await act(async () => {
    await result.current.send(input);
  });
  const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
  expect(headers.get("Authorization")).toBe("Bearer isolated-token");
  expect(headers.get("X-Electron-App")).toBe("true");
});
