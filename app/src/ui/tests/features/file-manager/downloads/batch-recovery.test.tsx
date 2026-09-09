import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DownloadBatchRecoveryDialog } from "@/features/file-manager/downloads/DownloadBatchRecoveryDialog";
import type { DownloadBatches } from "@/features/file-manager/downloads/download-batches";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  restore: vi.fn(),
  check: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/api/download-batch-recovery-api", () => ({
  downloadBatchRecoveryApi: api,
}));
const entry = {
  id: "file",
  name: "app.bin",
  relativePath: "app.bin",
  path: "E:/target/app.bin",
  kind: "file",
  size: 4,
  status: "conflict",
  action: "overwrite",
};
const summary = {
  id: "batch",
  name: "应用目录",
  hostLabel: "测试服务器",
  localPath: "E:/target",
  entries: 1,
  completed: 0,
  paused: 1,
  unknown: 0,
  existing: true,
  state: "available",
  savedAt: 1,
};
const native = { recovery: vi.fn(), choose: vi.fn(), forget: vi.fn() };
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  for (const fn of [...Object.values(api), ...Object.values(native)])
    fn.mockReset();
  api.list.mockResolvedValue([summary]);
  api.detail.mockResolvedValue({
    summary,
    entries: [entry],
    members: [{ entryId: "file", state: "paused" }],
  });
  native.choose.mockResolvedValue({
    ok: true,
    value: { id: "selected", path: "E:/target" },
  });
  native.forget.mockResolvedValue({ ok: true, value: null });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { downloadDirectories: native },
  });
});
afterEach(() => {
  cleanup();
});
function fixture() {
  const reservation = { close: vi.fn() },
    batches = {
      reserveRestore: vi.fn(() => reservation),
      restore: vi.fn(async () => {}),
      reconciled: vi.fn(),
    };
  render(
    <DownloadBatchRecoveryDialog
      sessionId="session"
      batches={batches as unknown as DownloadBatches}
    />,
  );
  return { reservation, batches };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复下载批次" }));
  fireEvent.click(await screen.findByRole("button", { name: /应用目录/ }));
  await screen.findByText("原下载目标清单");
  await waitFor(() =>
    expect(
      screen.getByLabelText(
        "我已核对原下载清单，并重新同意其中的目录合并计划。",
      ),
    ).toBeEnabled(),
  );
}
function review() {
  fireEvent.click(
    screen.getByLabelText("我已核对原下载清单，并重新同意其中的目录合并计划。"),
  );
  fireEvent.click(
    screen.getByLabelText("允许覆盖本次核对清单中的已有本地目标文件。"),
  );
}
it("requires reviewed overwrite, reserves capacity before native selection, then restores a paused batch", async () => {
  const f = fixture();
  await open();
  const button = screen.getByRole("button", {
    name: "选择原目标文件夹并恢复到暂停队列",
  });
  expect(button).toBeDisabled();
  review();
  expect(button).toBeEnabled();
  const restored = {
    summary,
    source: { entries: [entry] },
    target: { id: "restored" },
    members: [],
  };
  api.restore.mockResolvedValue(restored);
  fireEvent.click(button);
  await waitFor(() =>
    expect(f.batches.restore).toHaveBeenCalledWith(
      restored,
      undefined,
      f.reservation,
    ),
  );
  expect(f.batches.reserveRestore).toHaveBeenCalledWith(1);
  expect(f.batches.reserveRestore.mock.invocationCallOrder[0]).toBeLessThan(
    native.choose.mock.invocationCallOrder[0],
  );
  expect(api.restore).toHaveBeenCalledWith(
    "session",
    "batch",
    "selected",
    true,
    true,
  );
  expect(f.reservation.close).toHaveBeenCalled();
  expect(native.forget).not.toHaveBeenCalled();
});
it("keeps the plan on verification failure and releases only the fresh unused selection", async () => {
  const f = fixture();
  await open();
  review();
  api.restore.mockRejectedValue(Error("DOWNLOAD_SOURCE_CHANGED"));
  fireEvent.click(
    screen.getByRole("button", { name: "选择原目标文件夹并恢复到暂停队列" }),
  );
  await screen.findByRole("alert");
  expect(f.batches.restore).not.toHaveBeenCalled();
  expect(native.forget).toHaveBeenCalledWith("selected");
  expect(f.reservation.close).toHaveBeenCalled();
  expect(screen.getByText("E:/target/app.bin")).toBeVisible();
});
it("does not claim a saved batch when the native folder dialog is cancelled", async () => {
  const f = fixture();
  await open();
  review();
  native.choose.mockResolvedValue({ ok: true, value: null });
  fireEvent.click(
    screen.getByRole("button", { name: "选择原目标文件夹并恢复到暂停队列" }),
  );
  await waitFor(() => expect(f.reservation.close).toHaveBeenCalled());
  expect(api.restore).not.toHaveBeenCalled();
  expect(native.forget).not.toHaveBeenCalled();
});
it("reconciles unknown results without starting or discarding the batch", async () => {
  const unresolved = { ...summary, unknown: 1, paused: 0 };
  api.list.mockResolvedValue([unresolved]);
  api.detail.mockResolvedValue({
    summary: unresolved,
    entries: [entry],
    members: [{ entryId: "file", state: "unknown" }],
  });
  const f = fixture();
  await open();
  expect(screen.queryByRole("button", { name: "放弃未完成下载" })).toBeNull();
  const completed = [
    { entryId: "file", local: { id: "local", state: "completed" } },
  ];
  api.check.mockResolvedValue({ summary, completed });
  fireEvent.click(screen.getByRole("button", { name: "核对本地完成结果" }));
  await waitFor(() =>
    expect(f.batches.reconciled).toHaveBeenCalledWith("batch", completed),
  );
  expect(api.restore).not.toHaveBeenCalled();
  expect(api.discard).not.toHaveBeenCalled();
});
it("requires a second explicit action to discard partial downloads", async () => {
  fixture();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "放弃未完成下载" }));
  expect(api.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认放弃未完成下载" }));
  await waitFor(() =>
    expect(api.discard).toHaveBeenCalledWith("session", "batch"),
  );
});
