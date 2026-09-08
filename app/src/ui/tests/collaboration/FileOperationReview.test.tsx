import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FileOperationReview } from "../../features/collaboration/FileOperationReview";
import type { TaskOperation } from "@/types/collaboration-task";
import i18n from "../../i18n/i18n";
const api = vi.hoisted(() => ({ fileReview: vi.fn() }));
vi.mock("@/api/collaboration-api", () => ({
  collaborationApi: api,
  collaborationErrorCode: () => "FILE_REVIEW_REQUIRED",
}));
const op: TaskOperation = {
  id: "operation",
  digest: "digest",
  action: {
    type: "file.write",
    path: "/srv/config",
    canonicalPath: "/srv/config",
    proposalId: "proposal",
    version: "version",
    contentHash: "a".repeat(64),
    bytes: 12,
    format: { charset: "utf8", bom: false, lineEnding: "lf" },
  },
  decision: { outcome: "confirm", revision: 1, matchedRules: [], reasons: [] },
  status: "awaiting-approval",
};
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  api.fileReview.mockResolvedValue({
    reviewId: "receipt",
    proposalId: "proposal",
    operationId: "operation",
    digest: "digest",
    path: "/srv/config",
    canonicalPath: "/srv/config",
    format: { charset: "utf8", bom: false, lineEnding: "lf" },
    before: "port=80\npassword=local-only",
    after: "port=81\npassword=local-only",
    bytes: 12,
  });
});
afterEach(cleanup);
it("requires loading the exact Chinese change review before sending its receipt", async () => {
  const approve = vi.fn();
  render(
    <FileOperationReview
      taskId="task"
      operation={op}
      canApprove
      disabled={false}
      onApprove={approve}
    />,
  );
  const button = screen.getByRole("button", {
    name: "已审阅，确认保存文件",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "查看文件改动" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("拟保存的内容") as HTMLTextAreaElement).value,
    ).toBe("port=81\npassword=local-only"),
  );
  expect(
    (screen.getByLabelText("打开时的内容") as HTMLTextAreaElement).value,
  ).toContain("port=80");
  fireEvent.click(button);
  expect(approve).toHaveBeenCalledWith("receipt");
  expect(api.fileReview.mock.calls[0].slice(0, 2)).toEqual([
    "task",
    "operation",
  ]);
});
it("does not enable approval for a mismatched response", async () => {
  api.fileReview.mockResolvedValueOnce({
    proposalId: "other",
    digest: "other",
  });
  render(
    <FileOperationReview
      taskId="task"
      operation={op}
      canApprove
      disabled={false}
      onApprove={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件改动" }));
  await screen.findByRole("alert");
  expect(
    (
      screen.getByRole("button", {
        name: "已审阅，确认保存文件",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("aborts the body request when the review is closed", async () => {
  api.fileReview.mockReturnValue(new Promise(() => {}));
  const view = render(
    <FileOperationReview
      taskId="task"
      operation={op}
      canApprove
      disabled={false}
      onApprove={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件改动" }));
  await waitFor(() => expect(api.fileReview).toHaveBeenCalledOnce());
  const signal = api.fileReview.mock.calls[0][2] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
