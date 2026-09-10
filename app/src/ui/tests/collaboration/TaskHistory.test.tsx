import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  renderHook,
  act,
} from "@testing-library/react";
import i18n from "../../i18n/i18n";
import type { TaskView } from "@/types/collaboration-task";
vi.mock("@/api/task-history-api", () => ({
  taskHistoryApi: { query: vi.fn(), detail: vi.fn(), export: vi.fn() },
}));
vi.mock("@/api/collaboration-api", () => ({
  collaborationApi: { taskPage: vi.fn(), operationDetail: vi.fn() },
  collaborationErrorCode: (e: Error) => e.message,
}));
import { taskHistoryApi } from "@/api/task-history-api";
import { collaborationApi } from "@/api/collaboration-api";
import {
  TaskHistoryDialog,
  TaskHistoryButton,
} from "../../features/collaboration/TaskHistory";
import { useTaskOperationPage } from "../../features/collaboration/use-task-operation-page";
const row = {
  id: "event",
  at: Date.now(),
  type: "operation.completed",
  taskId: "task",
  program: "pwd",
  status: "succeeded",
  detail: "token",
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("opens Chinese read-only history, filters the task and renders detail as text", async () => {
  await i18n.changeLanguage("zh-CN");
  vi.mocked(taskHistoryApi.query).mockResolvedValue({
    items: [row],
    nextCursor: null,
    skipped: 1,
    scannedBytes: 20,
    retentionDays: 7,
    maxBytes: 104857600,
  });
  vi.mocked(taskHistoryApi.detail).mockResolvedValue({
    id: "event",
    offset: 0,
    text: '{"output":"<script>danger()</script> [redacted]"}',
    total: 55,
    nextOffset: null,
  });
  render(
    <>
      <TaskHistoryButton />
      <TaskHistoryDialog userId="one" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "操作历史" }));
  await screen.findByText("执行结果");
  fireEvent.click(screen.getByRole("button", { name: "只看该任务" }));
  await waitFor(() =>
    expect(taskHistoryApi.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: "task" }),
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: "查看详情" }));
  await screen.findByText(/<script>danger/);
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByRole("button", { name: /确认执行|重放/ })).toBeNull();
});
it("clears old user history and aborts pending detail when the account changes", async () => {
  await i18n.changeLanguage("zh-CN");
  vi.mocked(taskHistoryApi.query).mockResolvedValue({
    items: [row],
    nextCursor: null,
    skipped: 0,
    scannedBytes: 20,
    retentionDays: 7,
    maxBytes: 104857600,
  });
  let resolve!: (v: Awaited<ReturnType<typeof taskHistoryApi.detail>>) => void;
  vi.mocked(taskHistoryApi.detail).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const view = render(
    <>
      <TaskHistoryButton />
      <TaskHistoryDialog key="one" userId="one" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "操作历史" }));
  fireEvent.click(await screen.findByRole("button", { name: "查看详情" }));
  await waitFor(() => expect(taskHistoryApi.detail).toHaveBeenCalled());
  const signal = vi.mocked(taskHistoryApi.detail).mock.calls[0][2]!;
  view.rerender(
    <>
      <TaskHistoryButton />
      <TaskHistoryDialog key="two" userId="two" />
    </>,
  );
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({
      id: "event",
      offset: 0,
      text: "OLD_USER_PRIVATE_RECORD",
      total: 23,
      nextOffset: null,
    }),
  );
  expect(screen.queryByText(/OLD_USER_PRIVATE_RECORD/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
const summary = (id: string) =>
  ({
    id,
    title: id,
    state: "ready",
    commands: [],
    operations: [],
    workflowRuns: [],
    planRevision: 0,
    control: { controlEpoch: 1 },
    policyRevision: 1,
    operationPage: {
      offset: 0,
      total: 100,
      succeeded: 100,
      previousOffset: null,
      nextOffset: null,
      latest: { id: id + "-last", status: "succeeded" },
    },
  }) as TaskView;
it("loads only the selected task page and ignores an old task's late response", async () => {
  let finishFirst!: (v: TaskView) => void;
  vi.mocked(collaborationApi.taskPage).mockImplementation((id) =>
    id === "first"
      ? new Promise((r) => {
          finishFirst = r;
        })
      : Promise.resolve({
          ...summary(id),
          title: "Current task",
          operations: [],
          operationPage: { ...summary(id).operationPage!, offset: 50 },
        }),
  );
  const hook = renderHook(({ task }) => useTaskOperationPage(task), {
    initialProps: { task: summary("first") },
  });
  await waitFor(() =>
    expect(collaborationApi.taskPage).toHaveBeenCalledWith(
      "first",
      undefined,
      expect.any(AbortSignal),
    ),
  );
  const oldSignal = vi.mocked(collaborationApi.taskPage).mock.calls[0][2]!;
  hook.rerender({ task: summary("second") });
  await waitFor(() =>
    expect(hook.result.current.task?.title).toBe("Current task"),
  );
  await act(async () =>
    finishFirst({ ...summary("first"), title: "Old private task" }),
  );
  expect(oldSignal.aborted).toBe(true);
  expect(hook.result.current.task?.id).toBe("second");
  expect(hook.result.current.task?.title).toBe("Current task");
  act(() => hook.result.current.move(0));
  await waitFor(() =>
    expect(collaborationApi.taskPage).toHaveBeenLastCalledWith(
      "second",
      0,
      expect.any(AbortSignal),
    ),
  );
});

it("cancels the all-records export even when the new task filter is literally all", async () => {
  await i18n.changeLanguage("zh-CN");
  vi.mocked(taskHistoryApi.query).mockResolvedValue({
    items: [],
    nextCursor: null,
    skipped: 0,
    scannedBytes: 0,
    retentionDays: 7,
    maxBytes: 104857600,
  });
  let finish!: (
    value: Awaited<ReturnType<typeof taskHistoryApi.export>>,
  ) => void;
  vi.mocked(taskHistoryApi.export).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  render(
    <>
      <TaskHistoryButton />
      <TaskHistoryDialog userId="owner" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "操作历史" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "筛选" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "导出全部保留记录" }));
  await waitFor(() => expect(taskHistoryApi.export).toHaveBeenCalledOnce());
  const signal = vi.mocked(taskHistoryApi.export).mock.calls[0][1];
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "all" } });
  fireEvent.click(screen.getByRole("button", { name: "筛选" }));
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () =>
    finish({
      blob: new Blob(["late"]),
      bytes: 4,
      summary: {
        kind: "summary",
        completed: true,
        records: 1,
        skipped: 0,
        scannedBytes: 4,
      },
    }),
  );
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "导出该任务记录" })).toBeEnabled();
});
