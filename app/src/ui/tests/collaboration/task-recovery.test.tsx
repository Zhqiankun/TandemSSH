import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TaskRecovery } from "@/features/collaboration/TaskRecovery";
import type { TaskView } from "@/types/collaboration-task";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/api/task-recovery-api", () => ({ taskRecoveryApi: api }));
const summary = {
  id: "saved",
  title: "部署检查",
  hostId: 1,
  hostName: "fixture@server",
  source: "workflow",
  mode: "automatic",
  nextStep: 1,
  stepCount: 2,
  reconciliationRequired: false,
  resourceRecoveryRequired: false,
  state: "available",
  savedAt: 1,
};
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue([summary]);
  api.detail.mockResolvedValue({
    summary,
    steps: [
      { program: "pwd", args: [] },
      { program: "hostname", args: [] },
    ],
    operations: [],
  });
});
afterEach(cleanup);
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复任务" }));
  fireEvent.click(await screen.findByRole("button", { name: /部署检查/ }));
  await screen.findByText("原执行计划");
  await waitFor(() =>
    expect(
      screen.getByLabelText(
        "我已核对原计划、已执行结果和当前服务器，恢复为等待重新授权的任务。",
      ),
    ).toBeEnabled(),
  );
}
it("requires reviewing the original plan and returns a task awaiting authorization", async () => {
  const onRestored = vi.fn();
  render(<TaskRecovery sessionId="new-session" onRestored={onRestored} />);
  await open();
  const button = screen.getByRole("button", { name: "恢复为待授权任务" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  const task = { id: "new", state: "awaiting-authorization" };
  api.restore.mockResolvedValue(task);
  fireEvent.click(button);
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith(task));
  expect(api.restore).toHaveBeenCalledWith("saved", "new-session", undefined);
});
it("keeps unresolved recovery disabled until an explicit retry or skip is chosen", async () => {
  api.detail.mockResolvedValue({
    summary: { ...summary, reconciliationRequired: true },
    steps: [],
    operations: [],
  });
  render(<TaskRecovery sessionId="session" onRestored={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "恢复为待授权任务" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("我已核实，跳过当前步骤并保留异常记录。"),
  );
  expect(
    screen.getByRole("button", { name: "恢复为待授权任务" }),
  ).toBeEnabled();
});
it("shows a save failure immediately instead of hiding it in a closed dialog", async () => {
  api.save.mockRejectedValue({
    response: { data: { error: "TASK_RECOVERY_BUSY" } },
  });
  render(
    <TaskRecovery
      sessionId="session"
      task={{ id: "live", source: "workflow", state: "ready" } as TaskView}
      onRestored={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "暂停并保存任务进度" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("任务仍在收敛");
});
it("does not let a late restore response select a task in a different session", async () => {
  let resolve!: (v: unknown) => void;
  api.restore.mockReturnValue(new Promise((r) => (resolve = r)));
  const onRestored = vi.fn(),
    view = render(<TaskRecovery sessionId="old" onRestored={onRestored} />);
  await open();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "恢复为待授权任务" }));
  await waitFor(() => expect(api.restore).toHaveBeenCalled());
  view.unmount();
  resolve({ id: "old-task" });
  await new Promise((r) => setTimeout(r, 0));
  expect(onRestored).not.toHaveBeenCalled();
});

it("shows an AI save action and the saved conversation and model budget before restoring", async () => {
  const aiSummary = {
      ...summary,
      source: "assistant",
      nextStep: 0,
      stepCount: 0,
    },
    ai = {
      providerLabel: "自建模型",
      model: "fixture",
      turns: 3,
      maxTurns: 8,
      messages: [
        {
          id: "message",
          role: "assistant",
          content: "已经检查首步，等待回答。",
          status: "complete",
        },
      ],
      question: { id: "q", text: "接下来检查什么？" },
    };
  api.list.mockResolvedValue([aiSummary]);
  api.detail.mockResolvedValue({
    summary: aiSummary,
    steps: [],
    operations: [],
    ai,
  });
  render(
    <TaskRecovery
      sessionId="session"
      task={
        {
          id: "live-ai",
          source: "assistant",
          state: "paused-human",
        } as TaskView
      }
      onRestored={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "暂停并保存任务进度" }),
  ).toBeEnabled();
  await open();
  expect(screen.getByText(/自建模型/)).toBeVisible();
  expect(screen.getByText(/3.*8/)).toBeVisible();
  expect(screen.getByText(/接下来检查什么/)).toBeVisible();
  fireEvent.click(screen.getByText("查看已保存的 AI 对话"));
  expect(screen.getByText("已经检查首步，等待回答。")).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "恢复为待授权任务" }),
  ).toBeEnabled();
});
