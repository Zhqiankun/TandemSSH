import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
vi.mock("@/api/command-history-api", () => ({ getCommandHistory: get }));
import { useAutocompleteHistory } from "@/features/terminal/command-history/useAutocompleteHistory";
function deferred() {
  let resolve!: (rows: string[]) => void, reject!: (error: Error) => void;
  const promise = new Promise<string[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  get.mockReset();
});
it("ignores late snapshots from the previous host", async () => {
  const a = deferred(),
    b = deferred();
  get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const h = renderHook(({ id }) => useAutocompleteHistory(id, true), {
    initialProps: { id: 1 },
  });
  h.rerender({ id: 2 });
  await act(async () => b.resolve(["host-two"]));
  await act(async () => a.resolve(["host-one"]));
  expect(h.result.current.history.current).toEqual(["host-two"]);
});
it("merges additions and deletions over a pending snapshot without resurrecting deleted rows", async () => {
  const d = deferred();
  get.mockReturnValue(d.promise);
  const h = renderHook(() => useAutocompleteHistory(1, true));
  act(() => {
    h.result.current.add("new-one");
    h.result.current.remove("deleted");
    h.result.current.add("new-two");
    h.result.current.add("new-one");
  });
  await act(async () => d.resolve(["deleted", "old", "old"]));
  expect(h.result.current.history.current).toEqual([
    "new-one",
    "new-two",
    "old",
  ]);
});
it("rejects an old host mutation callback and clears disabled suggestions", async () => {
  const d = deferred();
  get.mockReturnValue(d.promise);
  const h = renderHook(({ enabled }) => useAutocompleteHistory(1, enabled), {
    initialProps: { enabled: true },
  });
  const removeOld = h.result.current.remove;
  h.rerender({ enabled: false });
  expect(removeOld("old")).toBe(false);
  await act(async () => d.resolve(["old"]));
  expect(h.result.current.history.current).toEqual([]);
  expect(get).toHaveBeenCalledTimes(1);
});
it("keeps accepted local entries when loading fails", async () => {
  const d = deferred();
  get.mockReturnValue(d.promise);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const h = renderHook(() => useAutocompleteHistory(1, true));
  act(() => h.result.current.add("accepted"));
  await act(async () => d.reject(Error("offline")));
  expect(h.result.current.history.current).toEqual(["accepted"]);
});
it("bounds suggestions while placing recent accepted commands first", async () => {
  get.mockResolvedValue(Array.from({ length: 600 }, (_, i) => "command-" + i));
  const h = renderHook(() => useAutocompleteHistory(1, true));
  await act(async () => {});
  act(() => h.result.current.add("new"));
  expect(h.result.current.history.current).toHaveLength(500);
  expect(h.result.current.history.current[0]).toBe("new");
});
it("clearing invalidates a pending snapshot but retains commands saved afterwards", async () => {
  const d = deferred();
  get.mockReturnValue(d.promise);
  const h = renderHook(() => useAutocompleteHistory(1, true));
  act(() => {
    h.result.current.clear();
    h.result.current.add("after-clear");
  });
  await act(async () => d.resolve(["old"]));
  expect(h.result.current.history.current).toEqual(["after-clear"]);
});
