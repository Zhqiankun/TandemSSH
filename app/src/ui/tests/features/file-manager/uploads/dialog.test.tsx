import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
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
  DesktopUploadSourceApi,
  NativeUploadSelection,
} from "@/types/upload-source";
vi.mock("@/api/upload-tree-api", () => ({
  uploadTreeApi: {
    preview: vi.fn(),
    forget: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
  },
}));
vi.mock("@/features/file-manager/uploads/upload-batches", () => ({
  uploadBatches: { start: vi.fn(async () => "batch") },
  uploadSourceValue: <T,>(
    r: { ok: true; value: T } | { ok: false; error: string },
  ) => {
    if (r.ok === false) throw Error(r.error);
    return r.value;
  },
}));
import { uploadTreeApi } from "@/api/upload-tree-api";
import { uploadBatches } from "@/features/file-manager/uploads/upload-batches";
import { UploadTreeDialog } from "@/features/file-manager/uploads/UploadTreeDialog";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.electronAPI;
});
const source: NativeUploadSelection = {
  id: "source",
  bytes: 8,
  excluded: 0,
  entries: [
    {
      id: "dir",
      name: "tree",
      relativePath: "tree",
      path: "C:/source/tree",
      kind: "directory",
      size: 0,
      lastModified: 0,
    },
    {
      id: "old",
      parentId: "dir",
      name: "file.txt",
      relativePath: "tree/file.txt",
      path: "C:/source/tree/file.txt",
      kind: "file",
      size: 4,
      lastModified: 0,
    },
    {
      id: "new",
      parentId: "dir",
      name: "new.txt",
      relativePath: "tree/new.txt",
      path: "C:/source/tree/new.txt",
      kind: "file",
      size: 4,
      lastModified: 0,
    },
  ],
};
async function fixture(files?: File[]) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh_CN",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  const native: Partial<DesktopUploadSourceApi> = {
    chooseDirectory: vi.fn(async () => ({
      ok: true as const,
      value: structuredClone(source),
    })),
    fromFiles: vi.fn(async () => ({
      ok: true as const,
      value: structuredClone(source),
    })),
    forget: vi.fn(async () => ({ ok: true as const, value: null })),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { uploadSources: native },
  });
  let revision = 0;
  vi.mocked(uploadTreeApi.preview).mockImplementation(async (input) => ({
    id: "target" + ++revision,
    revision: String(revision),
    sessionId: input.sessionId,
    path: input.path,
    canonicalRoot: input.path,
    state: "preview",
    expiresAt: Date.now() + 60000,
    entries: input.entries.map((e) => ({
      ...e,
      relativePath: e.parentId ? "tree/" + e.name : e.name,
      path: "/dest/" + e.name,
      status:
        e.id === "dir"
          ? "directory"
          : e.id === "old" && e.name === "file.txt"
            ? "conflict"
            : "new",
    })),
  }));
  const onClose = vi.fn(),
    view = render(
      <I18nextProvider i18n={i18n}>
        <UploadTreeDialog
          request={{
            sessionId: "session",
            path: "/dest",
            hostLabel: "测试服务器",
            files,
          }}
          onClose={onClose}
        />
      </I18nextProvider>,
    );
  await screen.findByRole("button", { name: "本批合并已有目录" });
  return { ...view, native, onClose };
}
it("requires explicit merge and overwrite, defaults to no takeover, and transfers preview ownership", async () => {
  const f = await fixture();
  expect(screen.getByRole("button", { name: "确认并开始上传" })).toBeDisabled();
  expect(uploadBatches.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "本批合并已有目录" }));
  fireEvent.click(screen.getByRole("button", { name: "本批覆盖已有文件" }));
  fireEvent.click(screen.getByRole("button", { name: "确认并开始上传" }));
  await waitFor(() => expect(f.onClose).toHaveBeenCalledOnce());
  expect(vi.mocked(uploadBatches.start).mock.calls[0][0]).toMatchObject({
    takeover: false,
    decisions: [
      { id: "dir", action: "merge" },
      { id: "old", action: "overwrite" },
      { id: "new", action: "create" },
    ],
  });
  f.unmount();
  expect(f.native.forget).not.toHaveBeenCalled();
});
it("invalidates conflict choices after a rename and checks the new remote mapping", async () => {
  await fixture();
  fireEvent.click(screen.getByRole("button", { name: "本批合并已有目录" }));
  fireEvent.click(screen.getByRole("button", { name: "本批覆盖已有文件" }));
  fireEvent.change(screen.getByLabelText("修改 tree/file.txt 的目标名称"), {
    target: { value: "renamed.txt" },
  });
  expect(screen.getByRole("button", { name: "确认并开始上传" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新检查目标" }));
  await waitFor(() =>
    expect(
      screen.queryByText("目标名称已修改，请重新检查后再开始。"),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("tree 的处理方式")).toHaveValue("");
  expect(uploadTreeApi.forget).toHaveBeenCalledWith("session", "target1");
  expect(
    vi.mocked(uploadTreeApi.preview).mock.calls[1][0].entries[1].name,
  ).toBe("renamed.txt");
  expect(uploadBatches.start).not.toHaveBeenCalled();
});
it("cascades a skipped parent and passes only the actual dropped File objects to the native bridge", async () => {
  const file = new File(["x"], "tree"),
    f = await fixture([file]);
  expect(f.native.fromFiles).toHaveBeenCalledWith([file]);
  expect(f.native.chooseDirectory).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("tree 的处理方式"), {
    target: { value: "skip" },
  });
  expect(screen.getByLabelText("tree/file.txt 的处理方式")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认并开始上传" }));
  await waitFor(() => expect(uploadBatches.start).toHaveBeenCalledOnce());
  expect(
    vi
      .mocked(uploadBatches.start)
      .mock.calls[0][0].decisions.every((d) => d.action === "skip"),
  ).toBe(true);
});
it("releases local and remote previews when dismissed before approval", async () => {
  const f = await fixture();
  f.unmount();
  await waitFor(() => expect(f.native.forget).toHaveBeenCalledWith("source"));
  expect(uploadTreeApi.forget).toHaveBeenCalledWith("session", "target1");
  expect(uploadBatches.start).not.toHaveBeenCalled();
});
