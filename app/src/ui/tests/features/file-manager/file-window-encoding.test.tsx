import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FileDocumentContent } from "@/types/file-document";
import type { SSHHost } from "@/types/index";
import i18n from "@/i18n/i18n";
const state = vi.hoisted(() => ({
  base: undefined as FileDocumentContent | undefined,
  reload: vi.fn(),
  updateWindow: vi.fn(),
}));
vi.mock("@/features/file-manager/hooks/use-file-document", () => ({
  useFileDocument: () => ({
    base: state.base,
    draft: state.base?.content ?? "",
    loading: false,
    saving: false,
    dirty: false,
    savedCount: 0,
    reload: state.reload,
  }),
}));
vi.mock("@/features/file-manager/hooks/use-file-draft", () => ({
  useFileDraft: () => ({ canSave: false }),
}));
vi.mock("@/features/file-manager/components/WindowManager", () => ({
  useWindowManager: () => ({
    windows: [{ id: "window", zIndex: 1 }],
    updateWindow: state.updateWindow,
    closeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    focusWindow: vi.fn(),
  }),
}));
vi.mock("@/features/file-manager/components/DraggableWindow", () => ({
  DraggableWindow: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/features/file-manager/components/FileViewer", () => ({
  FileViewer: () => null,
}));
vi.mock("@/features/file-manager/components/FileDraftPanel", () => ({
  FileDraftPanel: () => null,
}));
vi.mock("@/main-axios", () => ({
  downloadSSHFile: vi.fn(),
  getSSHStatus: vi.fn(),
  connectSSH: vi.fn(),
}));
import { FileWindow } from "@/features/file-manager/components/FileWindow";
const view = () => (
  <FileWindow
    windowId="window"
    file={{ name: "test.txt", path: "/test.txt", type: "file" }}
    sshSessionId="files"
    sshHost={{ id: 1 } as SSHHost}
  />
);
const select = () =>
  screen.getByLabelText(i18n.t("fileDocument.reopenEncoding"));
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  state.reload.mockReset();
  state.base = {
    content: "中文",
    path: "/test.txt",
    encoding: "utf8",
    document: {
      documentId: "doc",
      version: "v1",
      path: "/test.txt",
      canonicalPath: "/test.txt",
      hostIdentity: "fixture",
      size: 6,
      mtime: 1,
      mode: 0o644,
      viaSymlink: false,
      editable: true,
      format: { charset: "utf16le", bom: true, lineEnding: "none" },
    },
  };
});
afterEach(cleanup);
it("uses the detected file charset for reopening rather than default UTF-8", () => {
  render(view());
  expect(select()).toHaveValue("utf16le");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("fileDocument.reopen") }),
  );
  expect(state.reload).toHaveBeenCalledWith(false, "utf16le");
});
it("preserves an explicit choice during ordinary rerenders and sends it on reopen", () => {
  const page = render(view());
  fireEvent.change(select(), { target: { value: "gbk" } });
  page.rerender(view());
  expect(select()).toHaveValue("gbk");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("fileDocument.reopen") }),
  );
  expect(state.reload).toHaveBeenCalledWith(false, "gbk");
});
it("adopts a newly loaded version's actual charset instead of a stale pending choice", () => {
  const page = render(view());
  fireEvent.change(select(), { target: { value: "gbk" } });
  state.base = {
    ...state.base!,
    document: {
      ...state.base!.document,
      version: "v2",
      format: { charset: "utf16be", bom: true, lineEnding: "none" },
    },
  };
  page.rerender(view());
  expect(select()).toHaveValue("utf16be");
});

it("updates the editor tab title when save-as changes the document path", () => {
  const page = render(view());
  state.updateWindow.mockClear();
  state.base = {
    ...state.base!,
    document: {
      ...state.base!.document,
      path: "/另存结果.json",
      version: "saved-version",
    },
  };
  page.rerender(view());
  expect(state.updateWindow).toHaveBeenCalledWith("window", {
    title: "另存结果.json",
  });
});
