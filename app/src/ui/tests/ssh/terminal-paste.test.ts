import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  useTerminalPaste,
  type TerminalPasteTarget,
} from "../../features/terminal/use-terminal-paste";
afterEach(cleanup);
function setup() {
  const write = vi.fn();
  let target: TerminalPasteTarget | null = {
    identity: {},
    sessionId: "session-a",
    label: "测试终端",
    paste: write,
  };
  const hook = renderHook(() => useTerminalPaste(() => target));
  return {
    ...hook,
    write,
    setTarget: (next: TerminalPasteTarget | null) => {
      target = next;
    },
  };
}
it("pastes a single line directly but confirms multiline content exactly once", () => {
  const h = setup();
  act(() => h.result.current.request("pwd"));
  expect(h.write).toHaveBeenLastCalledWith("pwd");
  h.write.mockClear();
  const text = "printf '中文'\r\npwd\n";
  act(() => h.result.current.request(text));
  expect(h.write).not.toHaveBeenCalled();
  expect(h.result.current.pending?.text).toBe(text);
  act(() => {
    h.result.current.confirm();
    h.result.current.confirm();
  });
  expect(h.write).toHaveBeenCalledExactlyOnceWith(text);
  expect(h.result.current.pending).toBeNull();
});
it("previews a trailing newline and sends nothing when cancelled", () => {
  const h = setup();
  act(() => h.result.current.request("pwd\n"));
  expect(h.result.current.pending).not.toBeNull();
  act(() => h.result.current.cancel());
  act(() => h.result.current.confirm());
  expect(h.write).not.toHaveBeenCalled();
});
it.each(["socket", "session", "disconnected"])(
  "rejects a pending paste after %s changes",
  (kind) => {
    const h = setup();
    act(() => h.result.current.request("pwd\nls"));
    const old = h.result.current.pending!.target;
    h.setTarget(
      kind === "disconnected"
        ? null
        : {
            ...old,
            identity: kind === "socket" ? {} : old.identity,
            sessionId: kind === "session" ? "session-b" : old.sessionId,
          },
    );
    act(() => h.result.current.confirm());
    expect(h.write).not.toHaveBeenCalled();
    expect(h.result.current.stale).toBe(true);
  },
);
it("does not deliver a delayed clipboard read into a new connection", async () => {
  const h = setup();
  let resolve!: (text: string) => void;
  const read = new Promise<string>((r) => {
    resolve = r;
  });
  let work!: Promise<void>;
  act(() => {
    work = h.result.current.read(() => read);
  });
  h.setTarget({ identity: {}, sessionId: "new", label: "new", paste: h.write });
  await act(async () => {
    resolve("late text");
    await work;
  });
  expect(h.write).not.toHaveBeenCalled();
  expect(h.result.current.pending).toBeNull();
});
it("ignores a clipboard read completed after unmount", async () => {
  const h = setup();
  let resolve!: (text: string) => void;
  const read = new Promise<string>((r) => {
    resolve = r;
  });
  const work = h.result.current.read(() => read);
  h.unmount();
  resolve("late\ntext");
  await work;
  expect(h.write).not.toHaveBeenCalled();
});
