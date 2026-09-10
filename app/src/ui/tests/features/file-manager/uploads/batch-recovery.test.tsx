import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UploadBatchRecoveryDialog } from "@/features/file-manager/uploads/UploadBatchRecoveryDialog";
import type { UploadBatches } from "@/features/file-manager/uploads/upload-batches";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  restore: vi.fn(),
  check: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/api/upload-batch-recovery-api", () => ({
  uploadBatchRecoveryApi: api,
}));
const entry = {
    id: "file",
    name: "file.bin",
    kind: "file",
    path: "/srv/file.bin",
    relativePath: "file.bin",
    size: 4,
    lastModified: 1,
    status: "conflict",
    action: "overwrite",
  },
  summary = {
    id: "batch",
    name: "应用目录",
    path: "/srv",
    entries: 1,
    completed: 0,
    paused: 1,
    unknown: 0,
    existing: true,
    state: "available",
    updatedAt: 1,
  },
  source = {
    id: "selected",
    entries: [{ ...entry, path: "E:/source/file.bin" }],
    bytes: 4,
    excluded: 0,
  };
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue([summary]);
  api.detail.mockResolvedValue({
    summary,
    entries: [entry],
    members: [{ entryId: "file", state: "paused" }],
  });
  vi.stubGlobal("electronAPI", undefined);
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      uploadSources: {
        recoveryIdentity: vi.fn(),
        chooseDirectory: vi.fn(async () => ({ ok: true, value: source })),
        forget: vi.fn(async () => ({ ok: true, value: null })),
        fromFiles: vi.fn(),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fixture() {
  const reservation = { close: vi.fn() },
    batches = {
      reserveRestore: vi.fn(() => reservation),
      restore: vi.fn(async () => {}),
      reconciled: vi.fn(),
    };
  render(
    <UploadBatchRecoveryDialog
      sessionId="session"
      batches={batches as unknown as UploadBatches}
    />,
  );
  return { batches, reservation };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复批次" }));
  fireEvent.click(await screen.findByRole("button", { name: /应用目录/ }));
  await screen.findByText("原目标清单");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "重新选择原上传目录" }),
    ).toBeEnabled(),
  );
}
it("requires a fresh source and explicit review and overwrite confirmation", async () => {
  const f = fixture();
  await open();
  const restore = screen.getByRole("button", { name: "核验并恢复到暂停队列" });
  expect(restore).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新选择原上传目录" }));
  await waitFor(() =>
    expect(
      window.electronAPI!.uploadSources!.chooseDirectory,
    ).toHaveBeenCalled(),
  );
  await screen.findByText("E:/source/file.bin");
  await waitFor(() =>
    expect(
      screen.getByLabelText(
        "我已核对原目标清单，并重新同意本批次原有的目录合并计划。",
      ),
    ).toBeEnabled(),
  );
  expect(restore).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "我已核对原目标清单，并重新同意本批次原有的目录合并计划。",
    ),
  );
  expect(restore).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("允许覆盖本次核对清单中的已有目标文件。"),
  );
  api.restore.mockResolvedValue({
    summary,
    source,
    tree: { entries: [entry] },
    members: [],
  });
  fireEvent.click(restore);
  await waitFor(() => expect(f.batches.restore).toHaveBeenCalled());
  expect(api.restore).toHaveBeenCalledWith(
    "session",
    "batch",
    "selected",
    true,
    true,
  );
  expect(f.batches.reserveRestore).toHaveBeenCalledWith(1);
  expect(f.reservation.close).toHaveBeenCalled();
});
it("retains review information and closes the capacity reservation when server verification fails", async () => {
  const f = fixture();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "重新选择原上传目录" }));
  await screen.findByText("E:/source/file.bin");
  await waitFor(() =>
    expect(
      screen.getByLabelText(
        "我已核对原目标清单，并重新同意本批次原有的目录合并计划。",
      ),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByLabelText(
      "我已核对原目标清单，并重新同意本批次原有的目录合并计划。",
    ),
  );
  fireEvent.click(
    screen.getByLabelText("允许覆盖本次核对清单中的已有目标文件。"),
  );
  api.restore.mockRejectedValue(Error("UPLOAD_SOURCE_CHANGED"));
  const restore = screen.getByRole("button", { name: "核验并恢复到暂停队列" });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  await screen.findByRole("alert");
  expect(f.batches.restore).not.toHaveBeenCalled();
  expect(f.reservation.close).toHaveBeenCalled();
  expect(screen.getByText("原目标清单")).toBeInTheDocument();
});
