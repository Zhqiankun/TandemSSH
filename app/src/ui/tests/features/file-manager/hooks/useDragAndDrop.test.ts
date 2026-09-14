import { createElement } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import "@/i18n/i18n";
import zh from "../../../../locales/translated/zh_CN.json";
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDragAndDrop } from "../../../../features/file-manager/hooks/useDragAndDrop.js";

function makeEntry(name: string, isDirectory: boolean) {
  return { name, isDirectory, isFile: !isDirectory } as FileSystemEntry;
}

function makeDropEvent(entries: FileSystemEntry[], files: File[] = []) {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry,
  }));

  const dataTransfer = {
    items,
    files: Object.assign(files, { item: (i: number) => files[i] }),
  };

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  } as unknown as React.DragEvent;
}

describe("useDragAndDrop", () => {
  it("hands directory entries to onItemsDropped", () => {
    const onItemsDropped = vi.fn();
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onItemsDropped }),
    );

    const dir = makeEntry("myfolder", true);
    act(() => result.current.dragHandlers.onDrop(makeDropEvent([dir])));

    expect(onItemsDropped).toHaveBeenCalledWith([dir], expect.anything());
    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it("reads entries before state updates clear dataTransfer", () => {
    const onItemsDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped: vi.fn(), onItemsDropped }),
    );

    const dir = makeEntry("myfolder", true);
    const event = makeDropEvent([dir]);

    // Mimic the browser neutering dataTransfer once the handler unwinds.
    act(() => {
      result.current.dragHandlers.onDrop(event);
      (event.dataTransfer as unknown as { items: unknown[] }).items = [];
    });

    expect(onItemsDropped).toHaveBeenCalledWith([dir], expect.anything());
  });

  it("falls back to plain file upload when no directory is dropped", () => {
    const onFilesDropped = vi.fn();
    const onItemsDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onItemsDropped }),
    );

    const file = new File(["hi"], "a.txt");
    act(() =>
      result.current.dragHandlers.onDrop(
        makeDropEvent([makeEntry("a.txt", false)], [file]),
      ),
    );

    expect(onItemsDropped).not.toHaveBeenCalled();
    expect(onFilesDropped).toHaveBeenCalled();
  });

  it("rejects files over the size limit", () => {
    const onError = vi.fn();
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onError, maxFileSize: 1 }),
    );

    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });

    act(() => result.current.dragHandlers.onDrop(makeDropEvent([], [big])));

    expect(onFilesDropped).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});

it("reports size and unknown-type rejection in Chinese without uploading", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh_CN", resources: { zh_CN: { translation: zh } }, interpolation: { escapeValue: false } });
  const onError = vi.fn(), onFilesDropped = vi.fn();
  const { result } = renderHook(() => useDragAndDrop({ onFilesDropped, onError, maxFileSize: 1, allowedTypes: ["image"] }), {
    wrapper: ({ children }) => createElement(I18nextProvider, { i18n }, children),
  });
  const large = new File(["x"], "大文件.bin");
  Object.defineProperty(large, "size", { value: 2 * 1024 * 1024 });
  act(() => result.current.dragHandlers.onDrop(makeDropEvent([], [large])));
  expect(onError).toHaveBeenLastCalledWith("文件“大文件.bin”超过大小限制，最大允许 1 MB。");
  act(() => result.current.dragHandlers.onDrop(makeDropEvent([], [new File(["x"], "unknown.bin")])));
  expect(onError).toHaveBeenLastCalledWith("不支持此文件类型：未知类型。");
  expect(onFilesDropped).not.toHaveBeenCalled();
});
