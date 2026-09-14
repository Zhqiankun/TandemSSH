import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@/i18n/i18n";
import type { FileItem } from "@/types/index";
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 40,
        size: 40,
      })),
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));
import { FileManagerGrid } from "../../../features/file-manager/FileManagerGrid";
afterEach(cleanup);
const item = (name: string) =>
  ({
    name,
    path: "/" + name,
    type: "file",
    size: 1,
    modified: "",
    permissions: "-rw-r--r--",
  }) as FileItem;
it("drags every selected path even when the listing contains refreshed objects", () => {
  const selected = [item("a.txt"), item("b.txt")],
    files = selected.map((file) => ({ ...file, size: 2 })),
    setData = vi.fn();
  const view = render(
    <FileManagerGrid
      files={files}
      selectedFiles={selected}
      onFileOpen={vi.fn()}
      onSelectionChange={vi.fn()}
      onRefresh={vi.fn()}
      viewMode="list"
    />,
  );
  fireEvent.dragStart(
    view.container.querySelector('[data-file-path="/a.txt"]')!,
    { dataTransfer: { setData, effectAllowed: "" } },
  );
  expect(setData).toHaveBeenCalledWith(
    "text/plain",
    JSON.stringify({ type: "internal_files", files: ["/a.txt", "/b.txt"] }),
  );
});
it("drags only the pointed file when it is outside the current selection", () => {
  const setData = vi.fn(),
    view = render(
      <FileManagerGrid
        files={[item("a.txt"), item("b.txt")]}
        selectedFiles={[item("b.txt")]}
        onFileOpen={vi.fn()}
        onSelectionChange={vi.fn()}
        onRefresh={vi.fn()}
        viewMode="list"
      />,
    );
  fireEvent.dragStart(
    view.container.querySelector('[data-file-path="/a.txt"]')!,
    { dataTransfer: { setData, effectAllowed: "" } },
  );
  expect(setData).toHaveBeenCalledWith(
    "text/plain",
    JSON.stringify({ type: "internal_files", files: ["/a.txt"] }),
  );
});

it.each(["session-2:/", "session-1:/other"])(
  "does not dispatch an old drag after scope changes to %s",
  (scope) => {
    const file = item("a.txt"),
      target = { ...item("target"), type: "directory" as const },
      onDrop = vi.fn();
    const props = {
      files: [file, target],
      selectedFiles: [file],
      onFileOpen: vi.fn(),
      onSelectionChange: vi.fn(),
      onRefresh: vi.fn(),
      onFileDrop: onDrop,
      viewMode: "list" as const,
    };
    const view = render(
      <FileManagerGrid {...props} operationScope="session-1:/" />,
    );
    fireEvent.dragStart(
      view.container.querySelector('[data-file-path="/a.txt"]')!,
      { dataTransfer: { setData: vi.fn(), effectAllowed: "" } },
    );
    view.rerender(<FileManagerGrid {...props} operationScope={scope} />);
    fireEvent.drop(
      view.container.querySelector('[data-file-path="/target"]')!,
      { dataTransfer: { dropEffect: "move" } },
    );
    expect(onDrop).not.toHaveBeenCalled();
  },
);
it("dispatches the selected paths to the target in the unchanged scope", () => {
  const file = item("a.txt"),
    target = { ...item("target"), type: "directory" as const },
    onDrop = vi.fn();
  const view = render(
    <FileManagerGrid
      files={[file, target]}
      selectedFiles={[file]}
      onFileOpen={vi.fn()}
      onSelectionChange={vi.fn()}
      onRefresh={vi.fn()}
      onFileDrop={onDrop}
      viewMode="list"
      operationScope="session-1:/"
    />,
  );
  fireEvent.dragStart(
    view.container.querySelector('[data-file-path="/a.txt"]')!,
    { dataTransfer: { setData: vi.fn(), effectAllowed: "" } },
  );
  fireEvent.drop(view.container.querySelector('[data-file-path="/target"]')!, {
    dataTransfer: { dropEffect: "move" },
  });
  expect(onDrop).toHaveBeenCalledWith([file], target);
});

it("does not revive a drag after leaving and returning to its original scope", () => {
  const file = item("a.txt"),
    target = { ...item("target"), type: "directory" as const },
    onDrop = vi.fn();
  const props = {
    files: [file, target],
    selectedFiles: [file],
    onFileOpen: vi.fn(),
    onSelectionChange: vi.fn(),
    onRefresh: vi.fn(),
    onFileDrop: onDrop,
    viewMode: "list" as const,
  };
  const view = render(<FileManagerGrid {...props} operationScope="original" />);
  fireEvent.dragStart(
    view.container.querySelector('[data-file-path="/a.txt"]')!,
    { dataTransfer: { setData: vi.fn(), effectAllowed: "" } },
  );
  view.rerender(<FileManagerGrid {...props} operationScope="other" />);
  view.rerender(<FileManagerGrid {...props} operationScope="original" />);
  fireEvent.drop(view.container.querySelector('[data-file-path="/target"]')!, {
    dataTransfer: { dropEffect: "move" },
  });
  expect(onDrop).not.toHaveBeenCalled();
});

it.each(["file", "directory"] as const)("forwards external file and directory drops on a remote %s without moving remote items", (type) => {
  const target = { ...item("target"), type };
  const onExternalDrop = vi.fn(), onFileDrop = vi.fn(), onUpload = vi.fn();
  const view = render(<FileManagerGrid files={[target]} selectedFiles={[]} onFileOpen={vi.fn()} onSelectionChange={vi.fn()} onRefresh={vi.fn()} onExternalDrop={onExternalDrop} onFileDrop={onFileDrop} onUpload={onUpload} viewMode="list" />);
  const file = new File(["data"], "local.txt");
  const entry = { isDirectory: true, name: "folder" };
  const dataTransfer = { files: [file], items: [{ webkitGetAsEntry: () => entry }] };
  fireEvent.drop(view.container.querySelector('[data-file-path="/target"]')!, { dataTransfer });
  expect(onExternalDrop).toHaveBeenCalledOnce();
  expect(onExternalDrop.mock.calls[0][0].dataTransfer).toBe(dataTransfer);
  expect(onFileDrop).not.toHaveBeenCalled();
  expect(onUpload).not.toHaveBeenCalled();
});
