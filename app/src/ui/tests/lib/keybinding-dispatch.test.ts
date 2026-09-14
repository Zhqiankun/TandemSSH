import { describe, it, expect, vi } from "vitest";
import { dispatchKeybindingAction } from "../../lib/keybinding-dispatch";
import type { Terminal } from "@xterm/xterm";
import type { KeybindingDispatchContext } from "../../lib/keybinding-dispatch";

function makeContext(
  overrides: Partial<KeybindingDispatchContext> = {},
): KeybindingDispatchContext & {
  sentData: string[];
} {
  const sentData: string[] = [];
  const ws = {
    readyState: 1,
    send: vi.fn((raw: string) => {
      sentData.push(JSON.parse(raw).data);
    }),
  };

  const ctx: KeybindingDispatchContext & { sentData: string[] } = {
    terminal: {
      getSelection: vi.fn(() => ""),
      clearSelection: vi.fn(),
      paste: vi.fn(),
    } as unknown as Terminal,
    webSocketRef: { current: ws as unknown as WebSocket },
    writeTextToClipboard: vi.fn().mockResolvedValue(true),
    readTextFromClipboard: vi.fn().mockResolvedValue(""),
    getSnippetById: vi.fn().mockResolvedValue(undefined),
    sentData,
    ...overrides,
  };
  return ctx;
}

describe("dispatchKeybindingAction", () => {
  it("copy writes the selection to clipboard and clears it", async () => {
    const ctx = makeContext();
    (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
      "hello",
    );
    dispatchKeybindingAction({ type: "copy" }, ctx);
    expect(ctx.writeTextToClipboard).toHaveBeenCalledWith("hello");
    await Promise.resolve();
    expect(ctx.terminal.clearSelection).toHaveBeenCalled();
  });

  it("copy does nothing when there is no selection", () => {
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "copy" }, ctx);
    expect(ctx.writeTextToClipboard).not.toHaveBeenCalled();
    expect(ctx.terminal.clearSelection).not.toHaveBeenCalled();
  });

  it("paste reads the clipboard and pastes into the terminal", async () => {
    const ctx = makeContext({
      readTextFromClipboard: vi.fn().mockResolvedValue("pasted text"),
    });
    dispatchKeybindingAction({ type: "paste" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.terminal.paste).toHaveBeenCalledWith("pasted text");
  });

  it("sendControlCode sends the corresponding control byte", () => {
    const ctx = makeContext();
    dispatchKeybindingAction(
      { type: "sendControlCode", controlCode: "c" },
      ctx,
    );
    expect(ctx.sentData).toEqual(["\x03"]);
  });

  it("sendText sends literal text without a trailing return by default", () => {
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "sendText", text: "ls -la" }, ctx);
    expect(ctx.sentData).toEqual(["ls -la"]);
  });

  it("sendText appends \\r when appendEnter is true", () => {
    const ctx = makeContext();
    dispatchKeybindingAction(
      { type: "sendText", text: "ls -la", appendEnter: true },
      ctx,
    );
    expect(ctx.sentData).toEqual(["ls -la\r"]);
  });

  it("runSnippet resolves the snippet and sends its content with a trailing return", async () => {
    const ctx = makeContext({
      getSnippetById: vi.fn().mockResolvedValue({ content: "uptime" }),
    });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual(["uptime\r"]);
  });

  it("runSnippet does nothing when the snippet no longer exists", async () => {
    const ctx = makeContext({
      getSnippetById: vi.fn().mockResolvedValue(undefined),
    });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual([]);
  });

  it("runSnippet silently resolves host variables from hostContext", async () => {
    const ctx = makeContext({
      getSnippetById: vi
        .fn()
        .mockResolvedValue({ content: "ping $HOST -p $PORT" }),
      hostContext: { ip: "10.0.0.5", username: "root", port: 22 },
    });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual(["ping 10.0.0.5 -p 22\r"]);
  });

  it("runSnippet defers to onSnippetNeedsInputs instead of sending when $INPUT_n is present", async () => {
    const onSnippetNeedsInputs = vi.fn();
    const ctx = makeContext({
      getSnippetById: vi.fn().mockResolvedValue({ content: "echo $INPUT_1" }),
      onSnippetNeedsInputs,
    });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual([]);
    expect(onSnippetNeedsInputs).toHaveBeenCalledWith(
      {
        id: "1",
        content: "echo $INPUT_1",
      },
      expect.any(Function),
    );
  });
});

it("delegates custom paste actions to the terminal's confirmation policy", () => {
  const pasteFromClipboard = vi.fn(),
    ctx = makeContext({ pasteFromClipboard });
  dispatchKeybindingAction({ type: "paste" }, ctx);
  expect(pasteFromClipboard).toHaveBeenCalledOnce();
  expect(ctx.readTextFromClipboard).not.toHaveBeenCalled();
  expect(ctx.terminal.paste).not.toHaveBeenCalled();
  expect(ctx.sentData).toEqual([]);
});

it.each(["replace", "close", "detach"] as const)(
  "drops a delayed snippet after socket %s",
  async (change) => {
    let resolve!: (value: { content: string }) => void;
    const pending = new Promise<{ content: string }>((yes) => (resolve = yes));
    const needsInputs = vi.fn(),
      ctx = makeContext({
        getSnippetById: () => pending,
        onSnippetNeedsInputs: needsInputs,
      });
    const original = ctx.webSocketRef.current!;
    const replacement = makeContext();
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    if (change === "replace")
      ctx.webSocketRef.current = replacement.webSocketRef.current;
    if (change === "close")
      Object.defineProperty(original, "readyState", { value: 3 });
    if (change === "detach") ctx.webSocketRef.current = null;
    resolve({ content: "echo old-task" });
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual([]);
    expect(replacement.sentData).toEqual([]);
    expect(needsInputs).not.toHaveBeenCalled();
  },
);
it("does not open a stale snippet parameter dialog after reconnect", async () => {
  let resolve!: (value: { content: string }) => void;
  const pending = new Promise<{ content: string }>((yes) => (resolve = yes)),
    needsInputs = vi.fn();
  const ctx = makeContext({
    getSnippetById: () => pending,
    onSnippetNeedsInputs: needsInputs,
  });
  dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
  ctx.webSocketRef.current = makeContext().webSocketRef.current;
  resolve({ content: "echo $INPUT_1" });
  await Promise.resolve();
  expect(needsInputs).not.toHaveBeenCalled();
});
it("drops generic delayed clipboard text after reconnect", async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((yes) => (resolve = yes)),
    ctx = makeContext({ readTextFromClipboard: () => pending });
  dispatchKeybindingAction({ type: "paste" }, ctx);
  ctx.webSocketRef.current = makeContext().webSocketRef.current;
  resolve("old text");
  await Promise.resolve();
  expect(ctx.terminal.paste).not.toHaveBeenCalled();
});

it("keeps the parameter confirmation sender bound to its original connection", async () => {
  const pending = vi.fn(),
    ctx = makeContext({
      getSnippetById: async () => ({ content: "echo $INPUT_1" }),
      onSnippetNeedsInputs: pending,
    });
  dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
  await Promise.resolve();
  const send = pending.mock.calls[0][1] as (text: string) => boolean;
  const replacement = makeContext();
  ctx.webSocketRef.current = replacement.webSocketRef.current;
  expect(send("old confirmation\r")).toBe(false);
  expect(ctx.sentData).toEqual([]);
  expect(replacement.sentData).toEqual([]);
});
it("consumes the parameter confirmation sender only once", async () => {
  const pending = vi.fn(),
    ctx = makeContext({
      getSnippetById: async () => ({ content: "echo $INPUT_1" }),
      onSnippetNeedsInputs: pending,
    });
  dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
  await Promise.resolve();
  const send = pending.mock.calls[0][1] as (text: string) => boolean;
  expect(send("confirmed\r")).toBe(true);
  expect(send("confirmed\r")).toBe(false);
  expect(ctx.sentData).toEqual(["confirmed\r"]);
});

it.each(["copy", "paste", "runSnippet"] as const)(
  "reports %s asynchronous rejection without exposing the error",
  async (type) => {
    const onFailure = vi.fn(),
      reject = async () => {
        throw Error("PRIVATE_TEST_DETAIL");
      };
    const ctx = makeContext({
      onFailure,
      writeTextToClipboard: reject,
      readTextFromClipboard: reject,
      getSnippetById: reject,
    });
    (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
      "selected",
    );
    dispatchKeybindingAction(
      type === "runSnippet" ? { type, snippetId: "1" } : { type },
      ctx,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFailure).toHaveBeenCalledWith();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(ctx.sentData).toEqual([]);
    expect(ctx.terminal.clearSelection).not.toHaveBeenCalled();
  },
);
it("retains selection when clipboard reports false", async () => {
  const onFailure = vi.fn(),
    ctx = makeContext({ onFailure, writeTextToClipboard: async () => false });
  (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
    "selected",
  );
  dispatchKeybindingAction({ type: "copy" }, ctx);
  await Promise.resolve();
  expect(ctx.terminal.clearSelection).not.toHaveBeenCalled();
  expect(onFailure).toHaveBeenCalledOnce();
});
it("does not clear a newer selection after a delayed successful copy", async () => {
  let resolve!: (v: boolean) => void;
  const copied = new Promise<boolean>((yes) => (resolve = yes));
  const ctx = makeContext({ writeTextToClipboard: () => copied });
  (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
    "old",
  );
  dispatchKeybindingAction({ type: "copy" }, ctx);
  (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
    "new",
  );
  resolve(true);
  await Promise.resolve();
  expect(ctx.terminal.clearSelection).not.toHaveBeenCalled();
});

it("rejects pending parameter confirmation when SSH ends on an open WebSocket", async () => {
  let current = true;
  const pending = vi.fn();
  const ctx = makeContext({
    isSessionCurrent: () => current,
    getSnippetById: async () => ({ content: "echo $INPUT_1" }),
    onSnippetNeedsInputs: pending,
  });
  dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
  await Promise.resolve();
  current = false;
  expect((pending.mock.calls[0][1] as (text: string) => boolean)("stale")).toBe(
    false,
  );
  expect(ctx.webSocketRef.current?.readyState).toBe(1);
  expect(ctx.sentData).toEqual([]);
});
