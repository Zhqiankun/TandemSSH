import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
const api = vi.hoisted(() => ({
  getAiConversations: vi.fn(),
  getAiConversationPage: vi.fn(),
  getAiConversation: vi.fn(),
  getAiProviders: vi.fn(),
  getAiStatus: vi.fn(),
  send: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/api/ai-api", () => api);
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("@/main-axios", () => ({ saveUserPreferences: vi.fn() }));
vi.mock("@/features/ai/AiProviderSettings", () => ({
  AiProviderSettings: () => null,
}));
vi.mock("@/features/ai/useMentions", () => ({
  useMentions: () => ({ search: () => [] }),
  activeMentionQuery: () => null,
}));
vi.mock("@/features/ai/use-ai-stream", async () => {
  const React = await import("react");
  return {
    useAiStream: () => {
      const initial = React.useMemo(
        () => ({
          streaming: false,
          assistantText: "",
          tools: [],
          proposals: [],
          error: null,
          conversationId: null,
        }),
        [],
      );
      const [state, setState] = React.useState(initial);
      const reset = React.useCallback(() => {
        api.reset();
        setState(initial);
      }, [initial]);
      return { state, setState, reset, send: api.send, stop: vi.fn() };
    },
  };
});
import { AiPanel } from "@/features/ai/AiPanel";
const row = (id: number) => ({
  conversation: { id, providerId: 7, model: "saved-model" },
  messages: [
    {
      role: "assistant",
      content: "会话" + id,
      outcome: id === 2 ? "interrupted" : undefined,
    },
  ],
  proposals: [],
});
beforeEach(() => {
  api.getAiStatus.mockResolvedValue({ globallyEnabled: true, enabled: true });
  api.getAiProviders.mockResolvedValue([
    { id: 7, label: "模型", defaultModel: "default" },
  ]);
  api.getAiConversations.mockResolvedValue([
    { id: 1, title: "旧一" },
    { id: 2, title: "旧二" },
  ]);
  api.getAiConversationPage.mockResolvedValue({
    conversations: [
      { id: 1, title: "旧一" },
      { id: 2, title: "旧二" },
    ],
    nextCursor: null,
  });
  api.getAiConversation.mockImplementation(async (id: number) => row(id));
  api.send.mockResolvedValue(undefined);
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function picker() {
  await screen.findByRole("option", { name: "旧一" });
  return screen.findByRole("combobox", { name: "ai.chatHistory" });
}
it("opens saved history with incomplete status, continues its model and starts a separate new chat", async () => {
  render(<AiPanel />);
  fireEvent.change(await picker(), { target: { value: "2" } });
  await screen.findByText("会话2");
  expect(screen.getByRole("status").textContent).toBe(
    "ai.chatInterruptedRecord",
  );
  fireEvent.change(screen.getByPlaceholderText("ai.inputPlaceholder"), {
    target: { value: "继续" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
  await waitFor(() =>
    expect(api.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 2,
        model: "saved-model",
        message: "继续",
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
  expect(screen.queryByText("会话2")).toBeNull();
  expect(api.reset).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByPlaceholderText("ai.inputPlaceholder"), {
    target: { value: "新问题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
  expect(api.send).toHaveBeenLastCalledWith(
    expect.objectContaining({ conversationId: null, model: undefined }),
  );
});
it("ignores a late selected conversation and keeps the newer selection", async () => {
  let resolve!: (value: ReturnType<typeof row>) => void;
  api.getAiConversation.mockImplementation((id: number) =>
    id === 1
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(row(id)),
  );
  render(<AiPanel />);
  const select = await picker();
  fireEvent.change(select, { target: { value: "1" } });
  expect(
    (screen.getByPlaceholderText("ai.inputPlaceholder") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(select, { target: { value: "2" } });
  await screen.findByText("会话2");
  await act(async () => resolve(row(1)));
  expect(screen.queryByText("会话1")).toBeNull();
  expect(screen.getByText("会话2")).toBeTruthy();
});
it("reports load failure and prevents sending against an unknown conversation", async () => {
  api.getAiConversation.mockRejectedValue(Error("offline"));
  render(<AiPanel />);
  fireEvent.change(await picker(), { target: { value: "1" } });
  await screen.findByRole("alert");
  expect(
    (screen.getByPlaceholderText("ai.inputPlaceholder") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not let an old completion refresh replace a newly opened conversation", async () => {
  render(<AiPanel />);
  const select = await picker();
  fireEvent.change(select, { target: { value: "1" } });
  await screen.findByText("会话1");
  fireEvent.change(screen.getByPlaceholderText("ai.inputPlaceholder"), {
    target: { value: "消息" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
  await waitFor(() => expect(api.send).toHaveBeenCalledOnce());
  let resolve!: (value: ReturnType<typeof row>) => void;
  api.getAiConversation.mockImplementation((id: number) =>
    id === 1 ? new Promise((r) => (resolve = r)) : Promise.resolve(row(id)),
  );
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = api.send.mock.calls[0][0].onComplete(1, "迟到回复");
  });
  fireEvent.change(select, { target: { value: "2" } });
  await screen.findByText("会话2");
  await act(async () => {
    resolve(row(1));
    await refreshing;
  });
  expect(screen.queryByText("会话1")).toBeNull();
  expect(screen.queryByText("迟到回复")).toBeNull();
});
