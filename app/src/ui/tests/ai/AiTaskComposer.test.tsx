import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "../../i18n/i18n";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  providers: vi.fn(),
  preferences: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/api/ai-api", () => ({
  getAiStatus: mocks.status,
  getAiProviders: mocks.providers,
}));
vi.mock("@/main-axios", () => ({
  saveUserPreferences: mocks.preferences,
}));
vi.mock("@/api/ai-task-api", () => ({
  aiTaskApi: { create: mocks.create },
}));
vi.mock("../../features/ai/AiProviderSettings", () => ({
  AiProviderSettings: () => null,
}));

import { AiTaskComposer } from "../../features/ai/tasks/AiTaskComposer";

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  mocks.status.mockResolvedValue({ globallyEnabled: true, enabled: false });
  mocks.providers.mockResolvedValue([
    {
      id: 1,
      label: "我的模型",
      defaultModel: "custom-model",
      enabled: true,
    },
  ]);
  mocks.preferences.mockResolvedValue({});
  mocks.create.mockResolvedValue({ task: { id: "task" } });
});

afterEach(cleanup);

describe("Chinese BYOK AI chat", () => {
  it("sends a message with the chosen provider, model, mode and advanced call budget", async () => {
    render(
      <AiTaskComposer sessionId="session" onCreate={(action) => action()} />,
    );

    await screen.findByTitle("我的模型 · custom-model");
    expect(mocks.preferences).toHaveBeenCalledWith({
      aiAssistantEnabled: true,
    });
    expect(
      (screen.getByRole("button", { name: "发送" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByLabelText("模型调用预算（含规划）")).toBeNull();

    fireEvent.change(screen.getByLabelText("给 AI 发消息"), {
      target: { value: "检查目录" },
    });
    fireEvent.click(screen.getByRole("button", { name: "高级设置" }));
    fireEvent.change(screen.getByLabelText("模型调用预算（含规划）"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /自动执行/ }));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session",
          providerId: 1,
          model: "custom-model",
          goal: "检查目录",
          mode: "automatic",
          maxTurns: 6,
          autoAuthorizeReadOnly: false,
        }),
      ),
    );
  });

  it("turns the Docker suggestion into a one-step chat request", async () => {
    render(
      <AiTaskComposer sessionId="session" onCreate={(action) => action()} />,
    );
    await screen.findByTitle("我的模型 · custom-model");
    expect(screen.queryByRole("radio", { name: /人机协作/ })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "查看 Docker 正在运行的服务" }),
    );
    const message = screen.getByLabelText("给 AI 发消息");
    expect((message as HTMLTextAreaElement).value).toBe(
      "查看 Docker 正在运行的服务",
    );

    fireEvent.keyDown(message, { key: "Enter", shiftKey: false });

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session",
          goal: "查看 Docker 正在运行的服务",
          mode: "collaborative",
          autoAuthorizeReadOnly: true,
        }),
      ),
    );
  });

  it("respects an explicit global off switch without enabling the user or calling a model", async () => {
    mocks.status.mockResolvedValue({ globallyEnabled: false, enabled: false });
    render(
      <AiTaskComposer sessionId="session" onCreate={(action) => action()} />,
    );

    await screen.findByRole("alert");
    expect(mocks.preferences).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

it("keeps a delayed task creation bound to the session visible when submitted", async () => {
  let submit!: () => Promise<
    import("../../../types/collaboration-task").TaskView
  >;
  const onCreate = async (action: typeof submit) => {
    submit = action;
  };
  const { rerender } = render(
    <AiTaskComposer sessionId="session-a" onCreate={onCreate} />,
  );
  await screen.findByTitle("我的模型 · custom-model");
  fireEvent.change(screen.getByLabelText("给 AI 发消息"), {
    target: { value: "检查原服务器" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(mocks.create).not.toHaveBeenCalled();

  rerender(<AiTaskComposer sessionId="session-b" onCreate={onCreate} />);
  await act(async () => {
    await submit();
  });

  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sessionId: "session-a",
      goal: "检查原服务器",
    }),
  );
});
