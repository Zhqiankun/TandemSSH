import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileDraftSnapshot } from "@/types/file-draft";
import type { FileDocumentContent } from "@/types/file-document";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
const remote = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/api/file-draft-api", () => ({
  fileDraftApi: api,
  fileDraftError: () => "FILE_DRAFT_CONFLICT",
}));
vi.mock("@/api/file-document-api", () => ({
  fileDocumentApi: remote,
  fileDocumentFailure: () => ({ error: "FILE_RESPONSE_UNKNOWN" }),
}));
import { useFileDraft } from "../../../features/file-manager/hooks/use-file-draft";
import { useFileDocument } from "../../../features/file-manager/hooks/use-file-document";
import { FileDraftPanel } from "../../../features/file-manager/components/FileDraftPanel";
import i18n from "../../../i18n/i18n";
const base: FileDocumentContent = {
  content: "fresh remote",
  path: "/file",
  encoding: "utf8",
  document: {
    documentId: "document",
    version: "fresh-version",
    path: "/file",
    canonicalPath: "/file",
    hostIdentity: "test@host",
    size: 12,
    mtime: 1,
    mode: 0o644,
    viaSymlink: false,
    editable: true,
    format: { charset: "utf8", bom: false, lineEnding: "lf" },
  },
};
const stored: FileDraftSnapshot = {
  revision: "revision-one",
  savedAt: Date.now(),
  hostIdentity: "test@host",
  path: "/file",
  canonicalPath: "/file",
  original: "old remote",
  content: "recovered draft",
  format: base.document.format!,
};
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh_CN");
  api.read.mockResolvedValue(null);
  api.remove.mockResolvedValue(undefined);
  remote.read.mockResolvedValue(base);
  remote.close.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("waits for explicit local persistence and does not mark later typing as backed up", async () => {
  const h = renderHook(
    ({ content }) => useFileDraft("session", base, content),
    { initialProps: { content: "first" } },
  );
  await waitFor(() => expect(h.result.current.canSave).toBe(true));
  expect(api.write).not.toHaveBeenCalled();
  let resolve!: (v: FileDraftSnapshot) => void;
  api.write.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let pending!: Promise<boolean>;
  act(() => {
    pending = h.result.current.save();
  });
  h.rerender({ content: "newer" });
  await act(async () => {
    resolve({ ...stored, original: base.content, content: "first" });
    await pending;
  });
  expect(h.result.current.matches).toBe(false);
  expect(api.write.mock.calls[0][0]).toMatchObject({
    content: "first",
    expectedRevision: null,
    version: "fresh-version",
  });
});
it("drops late reads when a different file opens and clears recovery on logout", async () => {
  let resolve!: (v: FileDraftSnapshot) => void;
  api.read.mockImplementation((id: string) =>
    id === "one"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(null),
  );
  const h = renderHook(({ id }) => useFileDraft(id, base, ""), {
    initialProps: { id: "one" },
  });
  h.rerender({ id: "two" });
  await waitFor(() => expect(h.result.current.canSave).toBe(true));
  await act(async () => resolve(stored));
  expect(h.result.current.snapshot).toBeNull();
  act(() => window.dispatchEvent(new Event("termix:logout")));
  expect(h.result.current.canSave).toBe(false);
});
it("reviews all three contents and restores locally before a new remote save review", async () => {
  api.read.mockResolvedValue(stored);
  function Editor() {
    const doc = useFileDocument("session", "/file", async () => {}),
      draft = useFileDraft("session", doc.base, doc.draft);
    return (
      <>
        <FileDraftPanel
          draft={draft}
          original={doc.base?.content ?? ""}
          content={doc.draft}
          onRestore={doc.replaceDraft}
          disabled={doc.loading || doc.saving}
        />
        <output data-testid="editor">{doc.draft}</output>
        <button onClick={() => doc.requestSave()}>remote review</button>
        {doc.review && (
          <output data-testid="version">
            {doc.review.base.document.version}
          </output>
        )}
      </>
    );
  }
  render(<Editor />);
  await screen.findByRole("button", { name: "审阅并恢复草稿" });
  expect(screen.getByTestId("editor")).toHaveTextContent("fresh remote");
  fireEvent.click(screen.getByRole("button", { name: "审阅并恢复草稿" }));
  expect(screen.getByLabelText("保存草稿时的原文")).toHaveValue("old remote");
  expect(screen.getByLabelText("本次打开的远端内容")).toHaveValue(
    "fresh remote",
  );
  expect(
    screen.getByLabelText("本机加密草稿", { selector: "textarea" }),
  ).toHaveValue("recovered draft");
  fireEvent.click(screen.getByRole("button", { name: "确认恢复到编辑器" }));
  expect(screen.getByTestId("editor")).toHaveTextContent("recovered draft");
  expect(remote.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "remote review" }));
  expect(screen.getByTestId("version")).toHaveTextContent("fresh-version");
});
it("keeps an empty encrypted draft and requires explicit deletion", async () => {
  api.read.mockResolvedValue({ ...stored, content: "" });
  const restore = vi.fn();
  function Panel() {
    const d = useFileDraft("session", base, "");
    return (
      <FileDraftPanel
        draft={d}
        original={base.content}
        content=""
        onRestore={restore}
        disabled={false}
      />
    );
  }
  render(<Panel />);
  fireEvent.click(
    await screen.findByRole("button", { name: "审阅并恢复草稿" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认恢复到编辑器" }));
  expect(restore).toHaveBeenCalledWith("");
  fireEvent.click(screen.getByRole("button", { name: "删除本机草稿" }));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除草稿" }));
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledWith(
      "session",
      "fresh-version",
      "revision-one",
    ),
  );
});
