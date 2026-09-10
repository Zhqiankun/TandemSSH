import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock("@/api/task-history-api", () => ({ taskHistoryApi: api }));
import { HistoryExport } from "@/features/collaboration/HistoryExport";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  api.export.mockReset();
});
it("downloads a completed task export and reports skipped records in Chinese", async () => {
  await i18n.changeLanguage("zh-CN");
  const create = vi.fn(() => "blob:test");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  api.export.mockResolvedValue({
    blob: new Blob(["safe"]),
    bytes: 4,
    summary: {
      kind: "summary",
      completed: true,
      records: 40,
      skipped: 2,
      scannedBytes: 100,
    },
  });
  render(<HistoryExport taskId="task" />);
  fireEvent.click(screen.getByRole("button", { name: "导出该任务记录" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(api.export).toHaveBeenCalledWith(
    { taskId: "task" },
    expect.any(AbortSignal),
    expect.any(Function),
  );
  await screen.findByText(
    "已生成含 40 条记录的导出文件，请在保存位置确认。",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("2 处损坏");
});
it("cancels and ignores a late completed export after unmount", async () => {
  await i18n.changeLanguage("zh-CN");
  let finish!: (v: unknown) => void;
  api.export.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const create = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  const view = render(<HistoryExport />);
  fireEvent.click(screen.getByRole("button", { name: "导出全部保留记录" }));
  await screen.findByRole("button", { name: "取消" });
  const signal = api.export.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ blob: new Blob(["late"]), summary: { records: 1 } }),
  );
  expect(create).not.toHaveBeenCalled();
});
