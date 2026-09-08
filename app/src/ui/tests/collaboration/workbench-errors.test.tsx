import { afterEach, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { TaskView } from "../../../types/collaboration-task";
const api = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({
    tasks: [],
    policy: { revision: 1, sets: [] },
  })),
  takeover: vi.fn(async () => {}),
}));
vi.mock("@/api/collaboration-api", () => ({
  collaborationApi: api,
  collaborationErrorCode: (error: Error) => error.message,
}));
import { useTaskWorkbench } from "../../features/collaboration/use-task-workbench";
afterEach(cleanup);
it("clears prior action errors and ignores late errors after the task view changes", async () => {
  const { result } = renderHook(() => useTaskWorkbench("session"));
  await act(async () => {
    await result.current.run(async () => {
      throw Error("PRIOR_TASK_ERROR");
    });
  });
  expect(result.current.error).toBe("PRIOR_TASK_ERROR");
  let reject!: (e: Error) => void;
  const pending = new Promise<TaskView>((_, no) => {
    reject = no;
  });
  let running: Promise<TaskView | undefined>;
  act(() => {
    running = result.current.run(() => pending);
  });
  act(() => {
    result.current.clearActionError();
  });
  await act(async () => {
    reject(Error("LATE_PRIOR_TASK_ERROR"));
    await running;
  });
  expect(result.current.error).toBeUndefined();
  await act(async () => {
    await result.current.run(async () => {
      throw Error("CURRENT_TASK_ERROR");
    });
  });
  expect(result.current.error).toBe("CURRENT_TASK_ERROR");
});
