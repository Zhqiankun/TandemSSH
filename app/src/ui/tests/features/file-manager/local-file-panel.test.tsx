import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "@/locales/translated/zh_CN.json";
import { LocalFilePanel } from "@/features/file-manager/local/LocalFilePanel";
import type {
  DesktopLocalBrowserApi,
  LocalBrowserPage,
} from "@/types/local-file-browser";
const root = { id: "local-root", path: "C:\\work" };
const page: LocalBrowserPage = {
  rootId: root.id,
  path: root.path,
  relativePath: "",
  offset: 0,
  nextOffset: null,
  total: 2,
  truncated: false,
  entries: [
    {
      name: "目录",
      relativePath: "目录",
      kind: "directory",
      size: 0,
      modifiedAt: 1,
      hidden: false,
      version: "dir-v1",
    },
    {
      name: "配置.txt",
      relativePath: "配置.txt",
      kind: "file",
      size: 14,
      modifiedAt: 1,
      hidden: false,
      version: "file-v1",
    },
  ],
};
afterEach(() => {
  cleanup();
  delete window.electronAPI;
  vi.restoreAllMocks();
});
async function fixture(overrides: Partial<DesktopLocalBrowserApi> = {}) {
  const api: DesktopLocalBrowserApi = {
    choose: vi.fn(async () => ({ ok: true as const, value: root })),
    list: vi.fn(async (_id, relativePath) => ({
      ok: true as const,
      value: relativePath
        ? {
            ...page,
            entries: [],
            total: 0,
            path: root.path + "\\" + relativePath,
            relativePath,
          }
        : page,
    })),
    release: vi.fn(async () => ({ ok: true as const, value: null })),
    upload: vi.fn(),
    download: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { localBrowser: api },
  });
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
    interpolation: { escapeValue: false },
  });
  const onUpload = vi.fn(),
    onTargetChange = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LocalFilePanel
        onUpload={onUpload}
        onTargetChange={onTargetChange}
        canUpload
        targetLabel="测试机 · /srv/release"
      />
    </I18nextProvider>,
  );
  return { ...view, api, onUpload, onTargetChange };
}
it("shows Chinese navigation, properties and a version-bound upload selection", async () => {
  const f = await fixture();
  fireEvent.click(screen.getAllByRole("button", { name: "选择目录" })[0]);
  await screen.findByRole("checkbox", { name: "选择 配置.txt" });
  expect(screen.getByLabelText("本机目录路径")).toHaveValue(root.path);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 配置.txt" }));
  expect(screen.getByLabelText("选中项属性")).toHaveTextContent(
    "C:\\work/配置.txt",
  );
  fireEvent.click(screen.getByRole("button", { name: "预览上传（1 项）" }));
  expect(f.onUpload).toHaveBeenCalledWith({
    rootId: root.id,
    entries: [{ relativePath: "配置.txt", version: "file-v1" }],
  });
  expect(f.api.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  await waitFor(() =>
    expect(screen.getByLabelText("本机目录路径")).toHaveValue("C:\\work\\目录"),
  );
  expect(f.onTargetChange).toHaveBeenLastCalledWith({
    rootId: root.id,
    relativePath: "目录",
    path: "C:\\work\\目录",
  });
  fireEvent.click(screen.getByRole("button", { name: "返回上一个本机目录" }));
  await waitFor(() =>
    expect(screen.getByLabelText("本机目录路径")).toHaveValue(root.path),
  );
  f.unmount();
  expect(f.api.release).toHaveBeenCalledWith(root.id);
});
it("retains the chosen root after picker cancellation and rejects outside paths in Chinese", async () => {
  const f = await fixture();
  fireEvent.click(screen.getAllByRole("button", { name: "选择目录" })[0]);
  await screen.findByText("配置.txt");
  vi.mocked(f.api.choose).mockResolvedValueOnce({
    ok: true as const,
    value: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "更换目录" }));
  await waitFor(() => expect(f.api.choose).toHaveBeenCalledTimes(2));
  expect(f.api.release).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("本机目录路径"), {
    target: { value: "D:\\outside" },
  });
  fireEvent.submit(screen.getByLabelText("本机目录路径").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("所选目录内");
  expect(f.api.list).toHaveBeenCalledTimes(1);
});
it("coalesces a newer search behind pending I/O and does not publish the stale directory result", async () => {
  let finish!: (value: unknown) => void;
  const list = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      ok: true as const,
      value: { ...page, entries: [], total: 0 },
    });
  await fixture({ list });
  fireEvent.click(screen.getAllByRole("button", { name: "选择目录" })[0]);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("按名称筛选"), {
    target: { value: "absent" },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true as const, value: page }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(list.mock.calls[1][2]).toMatchObject({ search: "absent" });
  expect(screen.queryByText("配置.txt")).not.toBeInTheDocument();
  expect(await screen.findByText("没有符合条件的文件")).toBeInTheDocument();
});
it("releases a picker result arriving after unmount instead of retaining a file capability", async () => {
  let finish!: (value: unknown) => void;
  const choose = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as DesktopLocalBrowserApi["choose"];
  const f = await fixture({ choose });
  fireEvent.click(screen.getAllByRole("button", { name: "选择目录" })[0]);
  f.unmount();
  await act(async () => finish({ ok: true as const, value: root }));
  expect(f.api.release).toHaveBeenCalledWith(root.id);
  expect(f.api.list).not.toHaveBeenCalled();
});
