import "@testing-library/jest-dom/vitest";
import {
  act,
  renderHook,
  waitFor,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FileDocumentContent,
  SavedFileDocument,
} from "@/types/file-document";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/api/file-document-api", () => ({
  fileDocumentApi: api,
  fileDocumentFailure: (e: unknown) =>
    (e as { response?: { data: unknown } })?.response?.data ?? {
      error: "FILE_RESPONSE_UNKNOWN",
      commitMayHaveOccurred: true,
    },
}));
import { useFileDocument } from "../../../features/file-manager/hooks/use-file-document";
import { FileDocumentReview } from "../../../features/file-manager/components/FileDocumentReview";
import i18n from "../../../i18n/i18n";
const document = (
  content = "original",
  version = "v1",
): FileDocumentContent => ({
  content,
  path: "/配置%2F.txt",
  encoding: "utf8",
  document: {
    documentId: "doc",
    version,
    path: "/配置%2F.txt",
    canonicalPath: "/配置%2F.txt",
    size: content.length,
    mtime: 100,
    mode: 0o640,
    viaSymlink: false,
    editable: true,
    format: { charset: "utf8", bom: false, lineEnding: "lf" },
  },
});
const saved = (content: string): SavedFileDocument => ({
  document: document(content, "v2").document,
  bytes: content.length,
  atomic: true,
  warnings: [],
});
const failure = (error: string, latest?: FileDocumentContent) => ({
  response: { data: { error, latest } },
});
beforeEach(async () => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(document());
  api.close.mockResolvedValue(undefined);
  api.save.mockResolvedValue(saved("changed"));
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
async function setup() {
  const hook = renderHook(() =>
    useFileDocument("session", "/配置%2F.txt", async () => {}),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}
describe("file editor drafts", () => {
  it("saves empty text and preserves literal percent path", async () => {
    const h = await setup();
    api.save.mockResolvedValue(saved(""));
    act(() => h.result.current.edit(""));
    act(() => h.result.current.requestSave());
    await act(async () => {
      await h.result.current.save();
    });
    expect(api.save.mock.calls[0][0]).toMatchObject({
      content: "",
      path: "/配置%2F.txt",
      version: "v1",
    });
    expect(h.result.current.draft).toBe("");
    expect(h.result.current.dirty).toBe(false);
  });
  it("keeps typing after submission as unsaved content", async () => {
    const h = await setup();
    let finish!: (r: SavedFileDocument) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    act(() => h.result.current.edit("first"));
    act(() => h.result.current.requestSave());
    let pending!: Promise<boolean>;
    act(() => {
      pending = h.result.current.save();
    });
    act(() => h.result.current.edit("newer"));
    await act(async () => {
      finish(saved("first"));
      await pending;
    });
    expect(h.result.current.base?.content).toBe("first");
    expect(h.result.current.draft).toBe("newer");
    expect(h.result.current.dirty).toBe(true);
  });
  it("preserves a failed draft and requires fresh baseline after an uncertain response", async () => {
    const h = await setup();
    api.save.mockRejectedValue(Error("network"));
    act(() => h.result.current.edit("changed"));
    act(() => h.result.current.requestSave());
    await act(async () => {
      await h.result.current.save();
    });
    expect(h.result.current.draft).toBe("changed");
    await act(async () => {
      await h.result.current.save();
    });
    expect(api.save).toHaveBeenCalledTimes(1);
    api.read.mockRejectedValueOnce(Error("still offline"));
    await act(async () => {
      await h.result.current.reload(true);
    });
    expect(h.result.current.error?.commitMayHaveOccurred).toBe(true);
    api.read.mockResolvedValue(document("external", "v3"));
    await act(async () => {
      await h.result.current.reload(true);
    });
    expect(h.result.current.draft).toBe("changed");
    expect(h.result.current.base?.document.version).toBe("v3");
    expect(h.result.current.error).toBeUndefined();
  });
  it("retains the draft through conflict and adopts only the explicitly chosen latest baseline", async () => {
    const h = await setup();
    api.save.mockRejectedValue(
      failure("FILE_CONFLICT", document("remote", "v3")),
    );
    act(() => h.result.current.edit("local"));
    act(() => h.result.current.requestSave());
    await act(async () => {
      await h.result.current.save();
    });
    expect(h.result.current.base?.document.version).toBe("v1");
    act(() => h.result.current.acceptLatest(true));
    expect(h.result.current.draft).toBe("local");
    expect(h.result.current.base?.document.version).toBe("v3");
    expect(h.result.current.dirty).toBe(true);
  });
  it("closes the retained logical document and aborts an in-flight save on unmount", async () => {
    const h = await setup();
    api.save.mockReturnValue(new Promise(() => {}));
    act(() => h.result.current.edit("local"));
    act(() => h.result.current.requestSave());
    act(() => {
      void h.result.current.save();
    });
    const signal = api.save.mock.calls[0][1] as AbortSignal;
    h.unmount();
    expect(signal.aborted).toBe(true);
    expect(api.close).toHaveBeenCalledWith("session", "doc");
  });
  it("does not silently reload drafts when parent objects rerender", async () => {
    const h = await setup();
    act(() => h.result.current.edit("local"));
    h.rerender();
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(h.result.current.draft).toBe("local");
  });
  it("shows Chinese three-way conflict content without exposing it as HTML", () => {
    const base = document("<script>original</script>"),
      onLatest = vi.fn();
    render(
      <FileDocumentReview
        review={{ base, content: "local", format: base.document.format! }}
        draft="local"
        error={{ error: "FILE_CONFLICT", latest: document("remote", "v3") }}
        saving={false}
        onChange={() => {}}
        onBack={() => {}}
        onSave={() => {}}
        onLatest={onLatest}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "打开时的内容" })).toHaveValue(
      "<script>original</script>",
    );
    expect(screen.getByRole("textbox", { name: "远端最新内容" })).toHaveValue(
      "remote",
    );
    expect(screen.getByRole("textbox", { name: "本地草稿" })).toHaveValue(
      "local",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "保留草稿，按最新版本继续合并" }),
    );
    expect(onLatest).toHaveBeenCalledWith(true);
    expect(
      screen.queryByRole("button", { name: "确认保存" }),
    ).not.toBeInTheDocument();
  });
});

it("refreshes the actual save-as target after a lost commit response", async () => {
  const h = await setup();
  api.save.mockRejectedValue(Error("lost response"));
  act(() => h.result.current.edit("draft"));
  act(() => h.result.current.requestSave());
  act(() =>
    h.result.current.setReview({
      ...h.result.current.review!,
      saveAs: "/new-file",
    }),
  );
  await act(async () => {
    await h.result.current.save();
  });
  const next = document("draft", "new-version");
  next.document.path = next.path = "/new-file";
  api.read.mockResolvedValue(next);
  await act(async () => {
    await h.result.current.reload(true);
  });
  expect(api.read.mock.calls.at(-1)?.[1]).toBe("/new-file");
  expect(h.result.current.draft).toBe("draft");
  expect(h.result.current.base?.document.path).toBe("/new-file");
});
