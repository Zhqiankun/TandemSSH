import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
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
it("does not carry an answer draft into a different question of the same task", async () => {
  const initial = {
    ...run(20),
    error: undefined,
    phase: "awaiting-answer" as const,
    question: { id: "first", text: "第一问" },
  };
  const { rerender } = render(<AiTaskTranscript run={initial} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "旧问题的回答" },
  });
  rerender(
    <AiTaskTranscript
      run={{ ...initial, question: { id: "second", text: "第二问" } }}
    />,
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  expect(
    screen
      .getByRole("button", { name: "发送补充信息" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("preserves text edited while an earlier reply is being sent", async () => {
  let resolve!: () => void;
  api.reply.mockReturnValue(
    new Promise<void>((yes) => {
      resolve = yes;
    }),
  );
  render(
    <AiTaskTranscript
      run={{
        ...run(20),
        error: undefined,
        phase: "awaiting-answer",
        question: { id: "question", text: "补充信息" },
      }}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "已发送的回答" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送补充信息" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "发送期间新写的内容" },
  });
  await act(async () => {
    resolve();
  });
  expect(api.reply).toHaveBeenCalledExactlyOnceWith(
    "run",
    "question",
    "已发送的回答",
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "发送期间新写的内容",
  );
});
it("shows the user's request and the assistant response in one conversation", () => {
  render(
    <AiTaskTranscript
      run={{
        ...run(20),
        error: undefined,
        phase: "awaiting-authorization",
        turns: 1,
        messages: [
          {
            id: "user-message",
            role: "user",
            content: "帮我查一下 Docker 都跑了什么服务",
            status: "complete",
          },
          {
            id: "assistant-message",
            role: "assistant",
            content: "我会先查看正在运行的容器并整理服务、镜像和端口。",
            status: "complete",
          },
        ],
      }}
    />,
  );

  expect(screen.getByText("帮我查一下 Docker 都跑了什么服务")).toBeTruthy();
  expect(
    screen.getByText("我会先查看正在运行的容器并整理服务、镜像和端口。"),
  ).toBeTruthy();
});
it("sends a follow-up from the completed transcript and clears only the sent draft", async () => {
  const onContinue = vi.fn().mockResolvedValue(true);
  render(
    <AiTaskTranscript
      run={{
        ...run(20),
        error: undefined,
        phase: "completed",
        messages: [
          {
            id: "user",
            role: "user",
            content: "查看 Docker 服务",
            status: "complete",
          },
          {
            id: "assistant",
            role: "assistant",
            content: "当前运行 3 个容器。",
            status: "complete",
          },
        ],
      }}
      onContinue={onContinue}
    />,
  );

  const input = screen.getByRole("textbox", { name: "继续对话" });
  fireEvent.change(input, { target: { value: "再查一下它们的端口" } });
  fireEvent.keyDown(input, {
    key: "Enter",
    shiftKey: false,
    nativeEvent: { isComposing: false },
  });

  await waitFor(() =>
    expect(onContinue).toHaveBeenCalledExactlyOnceWith("再查一下它们的端口"),
  );
  expect((input as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "停止 AI 任务" })).toBeNull();
});

it("keeps the follow-up draft when creating the next turn fails", async () => {
  const onContinue = vi.fn().mockResolvedValue(false);
  render(
    <AiTaskTranscript
      run={{ ...run(20), error: undefined, phase: "completed-with-errors" }}
      onContinue={onContinue}
    />,
  );

  const input = screen.getByRole("textbox", { name: "继续对话" });
  fireEvent.change(input, { target: { value: "换个方法继续检查" } });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect((input as HTMLTextAreaElement).value).toBe("换个方法继续检查");
  expect(screen.queryByRole("button", { name: "停止 AI 任务" })).toBeNull();
});
