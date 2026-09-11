import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TaskView } from "../../../types/collaboration-task";
const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  takeover: vi.fn(),
  archive: vi.fn(),
}));
vi.mock("@/api/collaboration-api", () => ({
  collaborationApi: api,
  collaborationErrorCode: (e: Error) => e.message,
}));
import { useTaskWorkbench } from "../../features/collaboration/use-task-workbench";
const snapshot = (id: string) => ({
  tasks: [],
  session: { id },
  policy: { revision: 1, sets: [] },
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.snapshot.mockImplementation(async (id: string) => snapshot(id));
});
afterEach(cleanup);
it("does not refresh the old session after a pending action completes in another tab", async () => {
  const pending = deferred<TaskView>();
  const { result, rerender } = renderHook(({ id }) => useTaskWorkbench(id), {
    initialProps: { id: "a" },
  });
  await waitFor(() => expect(result.current.snapshot?.session.id).toBe("a"));
  let work!: Promise<TaskView | undefined>;
  act(() => {
    work = result.current.run(() => pending.promise);
  });
  rerender({ id: "b" });
  await waitFor(() => expect(result.current.snapshot?.session.id).toBe("b"));
  const calls = api.snapshot.mock.calls.length;
  await act(async () => {
    pending.resolve({ id: "task-a", sessionId: "a" } as TaskView);
    expect(await work).toBeUndefined();
  });
  expect(result.current.snapshot?.session.id).toBe("b");
  expect(result.current.snapshot?.tasks).toEqual([]);
  expect(api.snapshot.mock.calls.slice(calls).some((c) => c[0] === "a")).toBe(
    false,
  );
});
it("does not let an old takeover completion clear the current tab takeover lock", async () => {
  const old = deferred<void>(),
    current = deferred<void>();
  api.takeover.mockImplementation((id: string) =>
    id === "a" ? old.promise : current.promise,
  );
  const { result, rerender } = renderHook(({ id }) => useTaskWorkbench(id), {
    initialProps: { id: "a" },
  });
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = result.current.takeover();
  });
  rerender({ id: "b" });
  act(() => {
    second = result.current.takeover();
  });
  expect(api.takeover.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  await act(async () => {
    old.resolve();
    await first;
  });
  expect(result.current.takeoverPending).toBe(true);
  await act(async () => {
    current.resolve();
    await second;
  });
  expect(result.current.takeoverPending).toBe(false);
});

it("does not report an old archive as success to the new tab", async () => {
  const pending = deferred<void>();
  api.archive.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(({ id }) => useTaskWorkbench(id), {
    initialProps: { id: "a" },
  });
  await waitFor(() => expect(result.current.snapshot?.session.id).toBe("a"));
  let work!: Promise<boolean>;
  act(() => {
    work = result.current.archive("old-task");
  });
  rerender({ id: "b" });
  await waitFor(() => expect(result.current.snapshot?.session.id).toBe("b"));
  await act(async () => {
    pending.resolve();
    expect(await work).toBe(false);
  });
  expect(result.current.snapshot?.session.id).toBe("b");
});
