import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { DownloadQueue } from "@/features/file-manager/downloads/queue";
import { DownloadQueuePanel } from "@/features/file-manager/downloads/DownloadQueuePanel";
import { UploadQueue } from "@/features/file-manager/uploads/queue";
import { UploadQueuePanel } from "@/features/file-manager/uploads/UploadQueuePanel";
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(["upload", "download"] as const)(
  "shows Chinese %s estimates only while actively transferring",
  async (direction) => {
    await i18n.changeLanguage("zh-CN");
    const base = {
      id: "job",
      name: "file.txt",
      path: "/srv/file.txt",
      sessionId: "session",
      hostLabel: "测试服务器",
      size: 4096,
      speed: 1024,
    };
    if (direction === "download") {
      const queue = new DownloadQueue();
      const snapshot = vi
        .spyOn(queue, "getSnapshot")
        .mockReturnValue([{ ...base, writtenBytes: 0, state: "downloading" }]);
      const view = render(
        <DownloadQueuePanel queue={queue} sessionId="session" />,
      );
      expect(screen.getByText(/1 KiB\/s · 预计剩余 4 秒/)).toBeTruthy();
      snapshot.mockReturnValue([{ ...base, writtenBytes: 0, state: "paused" }]);
      view.rerender(<DownloadQueuePanel queue={queue} sessionId="session" />);
      expect(screen.queryByText(/预计剩余/)).toBeNull();
      snapshot.mockReturnValue([
        { ...base, size: undefined, writtenBytes: 0, state: "downloading" },
      ]);
      view.rerender(<DownloadQueuePanel queue={queue} sessionId="session" />);
      expect(screen.queryByText(/预计剩余/)).toBeNull();
    } else {
      const queue = new UploadQueue();
      const snapshot = vi
        .spyOn(queue, "getSnapshot")
        .mockReturnValue([
          { ...base, sourceCheckedBytes: 4096, state: "uploading" },
        ]);
      const view = render(
        <UploadQueuePanel
          queue={queue}
          sessionId="session"
          onRefresh={() => {}}
        />,
      );
      expect(screen.getByText(/1 KiB\/s · 预计剩余 4 秒/)).toBeTruthy();
      snapshot.mockReturnValue([
        { ...base, sourceCheckedBytes: 4096, state: "paused" },
      ]);
      view.rerender(
        <UploadQueuePanel
          queue={queue}
          sessionId="session"
          onRefresh={() => {}}
        />,
      );
      expect(screen.queryByText(/预计剩余/)).toBeNull();
      snapshot.mockReturnValue([
        {
          ...base,
          speed: Infinity,
          sourceCheckedBytes: 4096,
          state: "uploading",
        },
      ]);
      view.rerender(
        <UploadQueuePanel
          queue={queue}
          sessionId="session"
          onRefresh={() => {}}
        />,
      );
      expect(screen.queryByText(/预计剩余/)).toBeNull();
    }
  },
);
