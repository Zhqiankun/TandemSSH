import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "../../i18n/i18n";
import type { AiTaskView } from "../../../types/ai-task";
const api = vi.hoisted(() => ({
  budget: vi.fn(),
  stop: vi.fn(),
  reply: vi.fn(),
}));
vi.mock("@/api/ai-task-api", () => ({ aiTaskApi: api }));
import { AiTaskTranscript } from "../../features/ai/tasks/AiTaskTranscript";
const run = (maxTurns: number): AiTaskView => ({
  id: "run",
  taskId: "task",
  sessionId: "session",
  providerId: 1,
  providerLabel: "我的模型",
  model: "custom",
  goal: "检查",
  mode: "automatic",
  phase: "paused-error",
  turns: maxTurns,
  maxTurns,
  messages: [],
  error: "MODEL_BUDGET_EXCEEDED",
  createdAt: 0,
});
beforeEach(async () => {
  vi.resetAllMocks();
  api.budget.mockResolvedValue({});
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
it.each([
  [20, 10, 30],
  [60, 4, 64],
  [63, 1, 64],
])(
  "shows the actual increase from %s and sends the capped budget",
  async (before, increase, after) => {
    render(<AiTaskTranscript run={run(before)} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "需要重新确认任务授权",
    );
    fireEvent.click(
      screen.getByRole("button", { name: `增加 ${increase} 次模型调用预算` }),
    );
    await waitFor(() =>
      expect(api.budget).toHaveBeenCalledExactlyOnceWith("run", after),
    );
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.reply).not.toHaveBeenCalled();
  },
);
it("does not offer a budget increase above 64", () => {
  render(<AiTaskTranscript run={run(64)} />);
  expect(screen.queryByRole("button", { name: /增加/ })).toBeNull();
  expect(screen.getByRole("button", { name: "停止 AI 任务" })).toBeTruthy();
});
it("retains the paused state and displays a Chinese failure when the budget request fails", async () => {
  api.budget.mockRejectedValue(Error("offline"));
  render(<AiTaskTranscript run={run(60)} />);
  fireEvent.click(
    screen.getByRole("button", { name: "增加 4 次模型调用预算" }),
  );
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(
    screen
      .getByRole("button", { name: "增加 4 次模型调用预算" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(document.body.textContent).not.toContain("offline");
});
