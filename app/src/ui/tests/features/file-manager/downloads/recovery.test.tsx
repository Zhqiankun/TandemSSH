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
import type {
  DesktopDownloadApi,
  DownloadSource,
  LocalDownloadView,
} from "@/types/file-download";
import type {
  DownloadRecoverySummary,
  RestoredDownload,
} from "@/types/download-recovery";
import type { DownloadApiPort } from "@/api/file-download-api";
const recovery = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("@/api/download-recovery-api", () => ({
  downloadRecoveryApi: recovery,
}));
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { DownloadQueue } from "../../../../features/file-manager/downloads/queue";
import { DownloadQueuePanel } from "../../../../features/file-manager/downloads/DownloadQueuePanel";
import i18n from "../../../../i18n/i18n";
const digest = "a".repeat(64),
  source: DownloadSource = {
    id: "source",
    sessionId: "session",
    path: "/file",
    canonicalPath: "/file",
    size: 8,
    sha256: digest,
    hashes: [digest],
    chunkBytes: 4194304,
    state: "ready",
    expiresAt: Date.now() + 60000,
  },
  local: LocalDownloadView = {
    id: "local",
    path: "C:/target/file",
    temporaryPath: "C:/target/.part",
    size: 8,
    writtenBytes: 4,
    state: "paused",
  },
  row: DownloadRecoverySummary = {
    id: "recovery",
    hostLabel: "test server",
    path: "/file",
    localPath: local.path,
    size: 8,
    writtenBytes: 4,
    state: "available",
    existing: true,
  };
const restored: RestoredDownload = { source, local, summary: row };
function queue() {
  const api: DownloadApiPort = {
      prepare: vi.fn(async () => source),
      chunk: vi.fn(async () => new Uint8Array()),
      action: vi.fn(async () => source),
    },
    native: DesktopDownloadApi = {
      reset: vi.fn(async () => ({ ok: true as const, value: null })),
      choose: vi.fn(async () => ({ ok: true as const, value: local })),
      start: vi.fn(async () => ({ ok: true as const, value: local })),
      append: vi.fn(async () => ({ ok: true as const, value: local })),
      action: vi.fn(async () => ({ ok: true as const, value: local })),
      recovery: vi.fn(async () => ({ ok: true as const, value: null })),
    };
  const q = new DownloadQueue(api, () => native);
  q.setOwner("owner");
  return { q, api, native };
}
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh_CN");
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { downloads: { recovery: vi.fn() } },
  });
  recovery.list.mockResolvedValue([row]);
  recovery.restore.mockResolvedValue(restored);
  recovery.discard.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: undefined,
  });
});
it("shows recovery in an empty queue, requires fresh overwrite consent, and stays paused", async () => {
  const f = queue();
  render(<DownloadQueuePanel queue={f.q} sessionId="session" />);
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复下载" }));
  const restore = await screen.findByRole("button", {
    name: "核对并恢复到暂停队列",
  });
  expect(restore).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(restore);
  await waitFor(() => expect(f.q.getSnapshot()).toHaveLength(1));
  expect(f.q.getSnapshot()[0]).toMatchObject({
    state: "paused",
    writtenBytes: 4,
    recoveryId: "recovery",
  });
  expect(f.native.start).not.toHaveBeenCalled();
  expect(f.api.chunk).not.toHaveBeenCalled();
});
it("does not attach a late recovery result to another account", async () => {
  const f = queue();
  let resolve!: (value: RestoredDownload) => void;
  recovery.restore.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<DownloadQueuePanel queue={f.q} sessionId="session" />);
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复下载" }));
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "核对并恢复到暂停队列" }));
  await waitFor(() => expect(recovery.restore).toHaveBeenCalled());
  act(() => f.q.setOwner("other"));
  await act(async () => {
    resolve(restored);
  });
  expect(f.q.getSnapshot()).toEqual([]);
  expect(screen.queryByText("C:/target/file")).not.toBeInTheDocument();
});
it("requires a separate explicit confirmation to delete partial progress", async () => {
  const f = queue();
  render(<DownloadQueuePanel queue={f.q} sessionId="session" />);
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复下载" }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃此恢复" }));
  expect(recovery.discard).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "确认放弃并删除部分文件" }),
  );
  await waitFor(() =>
    expect(recovery.discard).toHaveBeenCalledWith("session", "recovery"),
  );
});
it("suspends only after durable save succeeds and clearing the row preserves recovery data", async () => {
  const f = queue();
  const id = f.q.restoreCheckpoint(restored);
  const persist = vi.fn(async () => row);
  await f.q.suspend(id, persist);
  expect(persist).toHaveBeenCalledWith("source", "local");
  expect(f.q.getSnapshot()[0].state).toBe("suspended");
  await f.q.clearFinished();
  expect(f.q.getSnapshot()).toEqual([]);
  expect(f.native.action).not.toHaveBeenCalled();
  expect(recovery.discard).not.toHaveBeenCalled();
});
it("preserves the live paused job when saving cannot be confirmed", async () => {
  const f = queue();
  const id = f.q.restoreCheckpoint(restored);
  await expect(
    f.q.suspend(id, async () => {
      throw Error("DOWNLOAD_RECOVERY_ENCRYPTION_UNAVAILABLE");
    }),
  ).rejects.toThrow();
  expect(f.q.getSnapshot()[0]).toMatchObject({
    state: "paused",
    local: { id: "local" },
    error: "DOWNLOAD_RECOVERY_ENCRYPTION_UNAVAILABLE",
  });
});
