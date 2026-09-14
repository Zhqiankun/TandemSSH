import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuditStorage } from "@/features/collaboration/AuditStorage";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({ storage: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/api/task-history-api", () => ({ taskHistoryApi: api }));
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("zh-CN");
  api.storage.mockResolvedValue({
    directory: "E:/fixture/audit",
    files: 2,
    bytes: 1024,
    retentionDays: 7,
    maxBytes: 104857600,
  });
  api.cleanup.mockResolvedValue({ removedFiles: 1, removedBytes: 512 });
});
afterEach(cleanup);
it("shows the actual location and requires confirmation before cleanup", async () => {
  const onClean = vi.fn();
  render(<AuditStorage onClean={onClean} />);
  expect(await screen.findByLabelText("当前用户日志位置")).toHaveValue(
    "E:/fixture/audit",
  );
  fireEvent.click(screen.getByRole("button", { name: "按留存规则清理" }));
  expect(api.cleanup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(api.cleanup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "按留存规则清理" }));
  fireEvent.click(screen.getByRole("button", { name: "确认清理" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "已清理 1 个日志文件",
  );
  expect(onClean).toHaveBeenCalledTimes(1);
});
it("does not claim cleanup succeeded when the request fails", async () => {
  api.cleanup.mockRejectedValue(Error("failure"));
  const onClean = vi.fn();
  render(<AuditStorage onClean={onClean} />);
  await screen.findByLabelText("当前用户日志位置");
  fireEvent.click(screen.getByRole("button", { name: "按留存规则清理" }));
  fireEvent.click(screen.getByRole("button", { name: "确认清理" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法确认");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(onClean).not.toHaveBeenCalled();
});
