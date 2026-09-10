import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "../../../../locales/translated/zh_CN.json";
import type {
  DownloadTreePreview,
  LocalDownloadTreePreview,
  DesktopDownloadDirectoryApi,
} from "@/types/download-tree";
vi.mock("@/api/download-tree-api", () => ({
  downloadTreeApi: { scan: vi.fn(), forget: vi.fn(async () => {}) },
}));
vi.mock("../../../../features/file-manager/downloads/download-batches", () => ({
  downloadBatches: { start: vi.fn(async () => "batch") },
}));
import { downloadTreeApi } from "@/api/download-tree-api";
import { downloadBatches } from "../../../../features/file-manager/downloads/download-batches";
import { DownloadTreeDialog } from "../../../../features/file-manager/downloads/DownloadTreeDialog";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.electronAPI;
});
const source: DownloadTreePreview = {
  id: "source",
  sessionId: "session",
  files: 2,
  directories: 1,
  totalBytes: 8,
  skipped: 0,
  scannedAt: 0,
  expiresAt: Date.now() + 60000,
  entries: [
    {
      id: "dir",
      name: "tree",
      path: "/tree",
      relativePath: "tree",
      kind: "directory",
      size: 0,
      modifiedAt: 0,
    },
    {
      id: "old",
      parentId: "dir",
      name: "file.txt",
      path: "/tree/file.txt",
      relativePath: "tree/file.txt",
      kind: "file",
      size: 4,
      modifiedAt: 0,
    },
    {
      id: "new",
      parentId: "dir",
      name: "new.txt",
      path: "/tree/new.txt",
      relativePath: "tree/new.txt",
      kind: "file",
      size: 4,
      modifiedAt: 0,
    },
  ],
};
async function fixture(fromPanel = false) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh_CN",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  const root: LocalDownloadTreePreview = {
    id: "native",
    revision: "start",
    path: "C:/selected",
    state: "preview",
    entries: [],
  };
  let revision = 0;
  const native: Partial<DesktopDownloadDirectoryApi> = {
    choose: vi.fn(async () => ({ ok: true as const, value: root })),
    preview: vi.fn(async (_id, entries) => ({
      ok: true as const,
      value: {
        ...root,
        revision: String(++revision),
        entries: entries.map((e) => ({
          ...e,
          relativePath: e.parentId ? "tree/" + e.name : e.name,
          path: "C:/selected/" + e.name,
          status:
            e.id === "dir"
              ? ("directory" as const)
              : e.id === "old" && e.name === "file.txt"
                ? ("conflict" as const)
                : ("new" as const),
          existing:
            e.id === "old" && e.name === "file.txt"
              ? { size: 9, modifiedAt: 0 }
              : undefined,
        })),
      },
    })),
    cancel: vi.fn(async () => ({
      ok: true as const,
      value: { ...root, state: "cancelled" as const },
    })),
    forget: vi.fn(async () => ({ ok: true as const, value: null })),
  };
  const localBrowser = {
    download: vi.fn(async () => ({ ok: true, value: root })),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { downloadDirectories: native, localBrowser },
  });
  vi.mocked(downloadTreeApi.scan).mockResolvedValue(structuredClone(source));
  const onClose = vi.fn(),
    rendered = render(
      <I18nextProvider i18n={i18n}>
        <DownloadTreeDialog
          request={{
            sessionId: "session",
            paths: ["/tree"],
            localTarget: fromPanel
              ? {
                  rootId: "browser-root",
                  relativePath: "artifacts",
                  path: "C:/selected",
                }
              : undefined,
            hostLabel: "测试服务器",
          }}
          onClose={onClose}
        />
      </I18nextProvider>,
    );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "选择目标文件夹" }),
    ).not.toBeDisabled(),
  );
  if (!fromPanel)
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
  await screen.findByRole("button", { name: "本批合并已有目录" });
  return { native, localBrowser, onClose, ...rendered };
}
describe("Chinese batch download preview", () => {
  it("requires explicit merge/overwrite and hands one immutable reviewed batch to the queue", async () => {
    const f = await fixture();
    expect(screen.getByText("整批下载预览")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认并开始下载" }),
    ).toBeDisabled();
    expect(downloadBatches.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "本批合并已有目录" }));
    fireEvent.click(screen.getByRole("button", { name: "本批覆盖已有文件" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并开始下载" }));
    await waitFor(() => expect(downloadBatches.start).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadBatches.start).mock.calls[0][0].decisions).toEqual(
      [
        { id: "dir", action: "merge" },
        { id: "old", action: "overwrite" },
        { id: "new", action: "create" },
      ],
    );
    await waitFor(() => expect(f.onClose).toHaveBeenCalledOnce());
    f.unmount();
    expect(f.native.cancel).not.toHaveBeenCalled();
  });
  it("requires another destination check after renaming and clears old conflict approvals", async () => {
    await fixture();
    fireEvent.click(screen.getByRole("button", { name: "本批合并已有目录" }));
    fireEvent.click(screen.getByRole("button", { name: "本批覆盖已有文件" }));
    fireEvent.change(screen.getByLabelText("修改 tree/file.txt 的目标名称"), {
      target: { value: "renamed.txt" },
    });
    expect(
      screen.getByRole("button", { name: "确认并开始下载" }),
    ).toBeDisabled();
    expect(
      screen.getByText("目标名称已修改，请重新检查后再开始。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新检查目标" }));
    await waitFor(() =>
      expect(
        screen.queryByText("目标名称已修改，请重新检查后再开始。"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "确认并开始下载" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("tree 的处理方式")).toHaveValue("");
    expect(downloadBatches.start).not.toHaveBeenCalled();
  });
  it("releases both previews when dismissed before starting", async () => {
    const f = await fixture();
    f.unmount();
    await waitFor(() => expect(f.native.forget).toHaveBeenCalledWith("native"));
    expect(f.native.cancel).toHaveBeenCalledWith("native");
    expect(downloadTreeApi.forget).toHaveBeenCalledWith("session", "source");
  });
});

it("uses the local-panel destination snapshot and still requires explicit conflict approval", async () => {
  const f = await fixture(true);
  expect(f.localBrowser.download).toHaveBeenCalledWith(
    "browser-root",
    "artifacts",
  );
  expect(f.native.choose).not.toHaveBeenCalled();
  expect(f.native.preview).toHaveBeenCalledWith(
    "native",
    expect.arrayContaining([expect.objectContaining({ name: "tree" })]),
  );
  expect(screen.getByRole("button", { name: "确认并开始下载" })).toBeDisabled();
  expect(downloadBatches.start).not.toHaveBeenCalled();
  f.unmount();
  await waitFor(() => expect(f.native.cancel).toHaveBeenCalledWith("native"));
});
