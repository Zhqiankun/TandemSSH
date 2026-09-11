import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({ query: vi.fn(), export: vi.fn() }));
vi.mock("@/api/task-history-api", () => ({ taskHistoryApi: api }));
vi.mock("@/api/collaboration-api", () => ({
  collaborationErrorCode: () => "HISTORY_UNAVAILABLE",
}));
import { TaskHistoryDialog } from "@/features/collaboration/TaskHistory";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows command arguments, a shortening hint, and the legacy program fallback", async () => {
  await i18n.changeLanguage("zh-CN");
  api.query.mockResolvedValue({
    items: [
      {
        id: "new",
        at: 1,
        type: "operation.completed",
        detail: "one",
        program: "ls",
        commandPreview: "ls '/path with spaces'",
        commandTruncated: true,
      },
      {
        id: "old",
        at: 1,
        type: "operation.completed",
        detail: "two",
        program: "pwd",
      },
    ],
    nextCursor: null,
    skipped: 0,
    scannedBytes: 100,
    retentionDays: 7,
    maxBytes: 104857600,
  });
  render(<TaskHistoryDialog userId="fixture" />);
  fireEvent(window, new CustomEvent("tandem-open-history", { detail: {} }));
  await screen.findByText("ls '/path with spaces'");
  expect(
    screen.getByText("命令摘要已截短，请查看详情中的记录参数。"),
  ).toBeInTheDocument();
  expect(screen.getByText("pwd")).toBeInTheDocument();
  expect(api.export).not.toHaveBeenCalled();
});
