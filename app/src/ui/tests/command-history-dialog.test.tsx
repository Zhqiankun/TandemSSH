import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/api/command-history-api", () => ({
  getCommandHistory: api.get,
  deleteCommandFromHistory: api.remove,
  clearCommandHistory: api.clear,
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: api.copy }));
import { CommandHistoryDialog } from "@/features/terminal/command-history/CommandHistoryDialog";
import i18n from "@/i18n/i18n";
const props = () => ({
  hostId: 1,
  hostName: "测试主机",
  canAppend: true,
  onClose: vi.fn(),
  onAppend: vi.fn(() => true),
  onDelete: vi.fn(),
  onClear: vi.fn(),
});
beforeEach(async () => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(["echo 中文", "pwd"]);
  api.remove.mockResolvedValue({ success: true });
  api.clear.mockResolvedValue({ success: true });
  api.copy.mockResolvedValue(true);
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
async function select() {
  fireEvent.click(await screen.findByRole("button", { name: "echo 中文" }));
}
it("loads and previews without executing, then appends only on explicit action", async () => {
  const p = props();
  render(<CommandHistoryDialog {...p} />);
  await select();
  expect(screen.getByLabelText("完整命令预览")).toHaveValue("echo 中文");
  expect(p.onAppend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "追加到终端" }));
  expect(p.onAppend).toHaveBeenCalledExactlyOnceWith("echo 中文");
  expect(p.onClose).toHaveBeenCalledOnce();
});
it("filters visible history and copies the full selected text", async () => {
  const p = props();
  render(<CommandHistoryDialog {...p} />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await screen.findByText("已复制");
  expect(api.copy).toHaveBeenCalledWith("echo 中文");
  fireEvent.change(screen.getByLabelText("搜索历史记录"), {
    target: { value: "pwd" },
  });
  expect(
    screen.queryByRole("button", { name: "echo 中文" }),
  ).not.toBeInTheDocument();
  expect(p.onAppend).not.toHaveBeenCalled();
});
it("preserves a failed deletion and removes it only after a successful retry", async () => {
  api.remove.mockRejectedValueOnce(Error("offline"));
  const p = props();
  render(<CommandHistoryDialog {...p} />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "echo 中文" })).toBeInTheDocument();
  expect(p.onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "echo 中文" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "pwd" })).toBeInTheDocument();
  expect(p.onDelete).toHaveBeenCalledExactlyOnceWith("echo 中文");
});
it("requires separate confirmation before clearing", async () => {
  const p = props();
  render(<CommandHistoryDialog {...p} />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "清空历史" }));
  expect(api.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(api.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "清空历史" }));
  fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
  await screen.findByText("没有匹配的历史记录");
  expect(api.clear).toHaveBeenCalledExactlyOnceWith(1);
  expect(p.onClear).toHaveBeenCalledOnce();
});
it("prevents appending into an unavailable original session", async () => {
  const p = props();
  render(<CommandHistoryDialog {...p} canAppend={false} />);
  await select();
  expect(screen.getByRole("button", { name: "追加到终端" })).toBeDisabled();
  expect(p.onAppend).not.toHaveBeenCalled();
});
it("shows control-bearing records for review but cannot append them", async () => {
  api.get.mockResolvedValue(["echo one\necho two"]);
  render(<CommandHistoryDialog {...props()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /^echo one\s+echo two$/ }),
  );
  expect(screen.getByLabelText("完整命令预览")).toHaveValue(
    "echo one\necho two",
  );
  expect(screen.getByRole("button", { name: "追加到终端" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制" })).toBeEnabled();
});
it("ignores a late old-host response", async () => {
  let old!: (value: string[]) => void;
  api.get
    .mockReturnValueOnce(
      new Promise((r) => {
        old = r;
      }),
    )
    .mockResolvedValueOnce(["new-host"]);
  const p = props(),
    h = render(<CommandHistoryDialog {...p} />);
  h.rerender(<CommandHistoryDialog {...p} hostId={2} />);
  await screen.findByRole("button", { name: "new-host" });
  await act(async () => old(["old-host"]));
  expect(
    screen.queryByRole("button", { name: "old-host" }),
  ).not.toBeInTheDocument();
});
