import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { useSnippetRunner } from "../../hooks/use-snippet-runner";
import type { Snippet, Tab } from "@/types/ui-types";
import i18n from "../../i18n/i18n";
const mocks = vi.hoisted(() => ({
  request: vi.fn(async () => "task"),
  send: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));
vi.mock("@/hooks/use-confirmation.ts", () => ({
  useConfirmation: () => ({ confirmWithToast: vi.fn() }),
}));
vi.mock("@/components/SnippetVariablesDialog", () => ({
  SnippetVariablesDialog: ({
    onConfirm,
  }: {
    onConfirm: (content: string, inputs: Record<string, string>) => void;
  }) => (
    <button onClick={() => onConfirm("unused", { INPUT_1: "x; rm /" })}>
      填写测试参数
    </button>
  ),
}));
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
function Harness() {
  const runner = useSnippetRunner(),
    snippet = {
      id: 1,
      name: "片段",
      content: 'printf "%s" "$INPUT_1"',
    } as Snippet,
    target = {
      id: "tab",
      terminalRef: {
        current: {
          requestControlledTask: mocks.request,
          sendInput: mocks.send,
        },
      },
    } as unknown as Tab;
  return (
    <>
      <button onClick={() => runner.runSnippet(snippet, [target])}>
        运行片段
      </button>
      {runner.dialog}
    </>
  );
}
it.each(["automatic", "collaborative"])(
  "%s snippet request never calls raw input",
  async (mode) => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "运行片段" }));
    fireEvent.click(screen.getByRole("button", { name: "填写测试参数" }));
    await screen.findByText("选择任务运行方式");
    if (mode === "automatic")
      fireEvent.click(
        screen.getByRole("radio", {
          name: i18n.t("tandem.collaboration.modes.automatic"),
        }),
      );
    fireEvent.click(screen.getByRole("button", { name: "创建待授权任务" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.request.mock.calls[0]).toEqual([
      {
        kind: "snippet",
        title: "片段",
        content: 'printf "%s" "$INPUT_1"',
        inputs: { INPUT_1: "x; rm /" },
      },
      { mode },
    ]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalled();
  },
);
it("cancelling the mode choice sends nothing", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "运行片段" }));
  fireEvent.click(screen.getByRole("button", { name: "填写测试参数" }));
  await screen.findByText("选择任务运行方式");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(screen.queryByText("选择任务运行方式")).toBeNull(),
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
