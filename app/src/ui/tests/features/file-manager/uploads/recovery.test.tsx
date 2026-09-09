import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import type { UploadApiPort } from "@/api/file-upload-api";
import type { UploadView, UploadManifest } from "@/types/file-upload";
import type { RestoredUpload } from "@/types/upload-recovery";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/api/upload-recovery-api", () => ({ uploadRecoveryApi: api }));
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { UploadQueue } from "../../../../features/file-manager/uploads/queue";
import { UploadQueuePanel } from "../../../../features/file-manager/uploads/UploadQueuePanel";
import i18n from "../../../../i18n/i18n";
const bytes = new Uint8Array([1, 2, 3, 4]),
  manifest: UploadManifest = {
    name: "source.bin",
    size: 4,
    lastModified: 100,
    hashes: [createHash("sha256").update(bytes).digest("hex")],
  },
  view: UploadView = {
    id: "upload",
    sessionId: "session",
    path: "/file",
    canonicalPath: "/file",
    name: "source.bin",
    totalBytes: 4,
    receivedBytes: 0,
    chunkBytes: 4194304,
    state: "paused",
    temporaryPath: "/.tandem-part",
    createdAt: 1,
    expiresAt: Date.now() + 60000,
  },
  result: RestoredUpload = {
    view,
    manifest,
    summary: {
      id: "recovery",
      name: "source.bin",
      path: "/file",
      size: 4,
      receivedBytes: 0,
      updatedAt: 1,
      existing: true,
      state: "available",
    },
  };
function fixture() {
  const calls: UploadApiPort = {
      prepare: vi.fn(async () => view),
      start: vi.fn(async () => view),
      chunk: vi.fn(async () => view),
      action: vi.fn(async () => view),
    },
    queue = new UploadQueue(calls);
  queue.setOwner("owner");
  return { queue, calls };
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  await i18n.changeLanguage("zh_CN");
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      uploadSources: {
        recoveryIdentity: vi.fn(),
        reset: vi.fn(async () => ({ ok: true, value: null })),
      },
    },
  });
  api.list.mockResolvedValue([result.summary]);
  api.detail.mockResolvedValue({ summary: result.summary, manifest });
  api.restore.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: undefined,
  });
});
it("requires the matching source and new overwrite consent, and never auto-starts", async () => {
  const f = fixture();
  render(
    <UploadQueuePanel
      queue={f.queue}
      sessionId="session"
      onRefresh={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复上传" }));
  const restore = await screen.findByRole("button", {
    name: "核验来源并恢复到暂停队列",
  });
  expect(restore).toBeDisabled();
  fireEvent.change(screen.getByLabelText("重新选择原始来源文件 source.bin"), {
    target: { files: [new File([bytes], "source.bin", { lastModified: 100 })] },
  });
  expect(restore).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(restore);
  await waitFor(() => expect(f.queue.getSnapshot()).toHaveLength(1));
  expect(f.queue.getSnapshot()[0]).toMatchObject({
    state: "paused",
    recoveryId: "recovery",
  });
  expect(f.calls.start).not.toHaveBeenCalled();
  expect(f.calls.chunk).not.toHaveBeenCalled();
});
it("rejects modified file bytes before sending a restore request", async () => {
  const f = fixture();
  render(
    <UploadQueuePanel
      queue={f.queue}
      sessionId="session"
      onRefresh={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复上传" }));
  const input = await screen.findByLabelText("重新选择原始来源文件 source.bin");
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([4, 3, 2, 1])], "source.bin", {
          lastModified: 100,
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "核验来源并恢复到暂停队列" }),
  );
  await screen.findByRole("alert");
  expect(api.restore).not.toHaveBeenCalled();
});
it("does not insert a delayed result after the account changes", async () => {
  const f = fixture();
  let resolve!: (r: RestoredUpload) => void;
  api.restore.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(
    <UploadQueuePanel
      queue={f.queue}
      sessionId="session"
      onRefresh={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看可恢复上传" }));
  fireEvent.change(
    await screen.findByLabelText("重新选择原始来源文件 source.bin"),
    {
      target: {
        files: [new File([bytes], "source.bin", { lastModified: 100 })],
      },
    },
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "核验来源并恢复到暂停队列" }),
  );
  await waitFor(() => expect(api.restore).toHaveBeenCalled());
  act(() => f.queue.setOwner("other"));
  await act(async () => resolve(result));
  expect(f.queue.getSnapshot()).toEqual([]);
});
it("does not send destructive cleanup for a recovered upload during sign-out", async () => {
  const f = fixture(),
    reservation = f.queue.reserveRecovery();
  reservation.accept(
    result,
    new File([bytes], "source.bin", { lastModified: 100 }),
  );
  f.queue.resetForSignOut();
  expect(f.calls.action).not.toHaveBeenCalled();
  expect(window.electronAPI!.uploadSources!.reset).toHaveBeenCalled();
  expect(f.queue.getSnapshot()).toEqual([]);
});
