import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
vi.mock("@/main-axios.ts", () => ({ saveCommandToHistory: save }));
import { useCommandTracker } from "@/features/terminal/command-history/useCommandTracker";
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
it("preserves Chinese and emoji in submitted command history", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => h.result.current.trackInput('printf "中文😀"\r'));
  expect(save).toHaveBeenCalledWith(1, 'printf "中文😀"');
});
it("removes a complete Unicode character on backspace", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => h.result.current.trackInput("echo 😀\x7f中\r"));
  expect(save).toHaveBeenCalledWith(1, "echo 中");
});
it("drops unfinished input when switching hosts", () => {
  const h = renderHook(({ hostId }) => useCommandTracker({ hostId }), {
    initialProps: { hostId: 1 },
  });
  act(() => h.result.current.trackInput("old-"));
  h.rerender({ hostId: 2 });
  act(() => h.result.current.trackInput("new\r"));
  expect(save).toHaveBeenCalledWith(2, "new");
});
it("drops unfinished input and escape state when disabling tracking", () => {
  const h = renderHook(
    ({ enabled }) => useCommandTracker({ hostId: 1, enabled }),
    { initialProps: { enabled: true } },
  );
  act(() => h.result.current.trackInput("old\x1b["));
  h.rerender({ enabled: false });
  h.rerender({ enabled: true });
  act(() => h.result.current.trackInput("new\r"));
  expect(save).toHaveBeenCalledWith(1, "new");
});
it("keeps fragmented escape sequences out of ordinary history", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => {
    h.result.current.trackInput("pwd\x1b[");
    h.result.current.trackInput("A\r");
  });
  expect(save).toHaveBeenCalledWith(1, "pwd");
});
it("preserves a Unicode character split between input callbacks", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => {
    h.result.current.trackInput("echo \ud83d");
    h.result.current.trackInput("\ude00\r");
  });
  expect(save).toHaveBeenCalledWith(1, "echo 😀");
});
it("keeps cancellation and sensitive-command filtering after Unicode support", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => {
    h.result.current.trackInput("echo 中文\x03pwd\r");
    h.result.current.trackInput("export TOKEN=hidden\r");
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(1, "pwd");
});
it("keeps local line tracking immediate while persistence follows accepted input only", () => {
  const h = renderHook(() => ({
    local: useCommandTracker({ hostId: 1, persist: false }),
    accepted: useCommandTracker({ hostId: 1 }),
  }));
  act(() => h.result.current.local.trackInput("繁體中文😀OK\r"));
  expect(save).not.toHaveBeenCalled();
  act(() => {
    h.result.current.accepted.trackInput("繁體中文");
    h.result.current.accepted.trackInput("OK\r");
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(1, "繁體中文OK");
});
it("resets unfinished text and escape state for a new session on the same host", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => {
    h.result.current.bindSession("old");
    h.result.current.trackInput("old-prefix\x1b[");
    h.result.current.bindSession("new");
    h.result.current.trackInput("pwd\r");
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(1, "pwd");
});
it("preserves unfinished input when reattaching the same live session", () => {
  const h = renderHook(() => useCommandTracker({ hostId: 1 }));
  act(() => {
    h.result.current.bindSession("same");
    h.result.current.trackInput("echo ");
    h.result.current.bindSession("same");
    h.result.current.trackInput("中文\r");
  });
  expect(save).toHaveBeenCalledWith(1, "echo 中文");
});
it.each([
  "export TOKEN=fixture",
  "sshpass -p fixture ssh host",
  "mysql -pfixture",
])("does not offer a filtered sensitive command %s", async (command) => {
  const notified = vi.fn();
  const h = renderHook(() =>
    useCommandTracker({ hostId: 1, onHistorySaved: notified }),
  );
  act(() => h.result.current.trackInput(command + "\r"));
  await act(async () => {});
  expect(save).not.toHaveBeenCalled();
  expect(notified).not.toHaveBeenCalled();
});
it("notifies suggestions only after the server actually saved a history row", async () => {
  const notified = vi.fn();
  save.mockResolvedValueOnce({ id: 0 });
  const h = renderHook(() =>
    useCommandTracker({ hostId: 1, onHistorySaved: notified }),
  );
  act(() => h.result.current.trackInput("pwd\r"));
  await act(async () => {});
  expect(notified).not.toHaveBeenCalled();
  act(() => h.result.current.trackInput("ls\r"));
  expect(notified).not.toHaveBeenCalled();
  await act(async () => {});
  expect(notified).toHaveBeenCalledExactlyOnceWith("ls");
});
it("does not offer a command whose history save failed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  save.mockRejectedValueOnce(Error("offline"));
  const notified = vi.fn();
  const h = renderHook(() =>
    useCommandTracker({ hostId: 1, onHistorySaved: notified }),
  );
  act(() => h.result.current.trackInput("pwd\r"));
  await act(async () => {});
  expect(notified).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
it("ignores a late save callback from an old host or session", async () => {
  let resolve!: (value: { id: number }) => void;
  save.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const notified = vi.fn();
  const h = renderHook(
    ({ id }) => useCommandTracker({ hostId: id, onHistorySaved: notified }),
    { initialProps: { id: 1 } },
  );
  act(() => {
    h.result.current.bindSession("old");
    h.result.current.trackInput("pwd\r");
  });
  h.rerender({ id: 2 });
  act(() => h.result.current.bindSession("new"));
  await act(async () => resolve({ id: 1 }));
  expect(notified).not.toHaveBeenCalled();
});
it("ignores late history notifications when only the backend session changes", async () => {
  let resolve!: (value: { id: number }) => void;
  save.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const notified = vi.fn();
  const h = renderHook(() =>
    useCommandTracker({ hostId: 1, onHistorySaved: notified }),
  );
  act(() => {
    h.result.current.bindSession("old");
    h.result.current.trackInput("pwd\r");
    h.result.current.bindSession("new");
  });
  await act(async () => resolve({ id: 1 }));
  expect(notified).not.toHaveBeenCalled();
});
