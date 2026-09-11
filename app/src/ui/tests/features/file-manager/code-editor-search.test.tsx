import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import i18n from "../../../i18n/i18n";
import {
  CodeEditor,
  type CodeEditorHandle,
} from "../../../features/file-manager/components/CodeEditor";
// jsdom lacks Range layout APIs used by CodeMirror measurements. These tests
// exercise text commands, not geometry; preserve any existing descriptors.
const rangeRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const rangeBounds = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterAll(() => {
  for (const [name, descriptor] of [
    ["getClientRects", rangeRects],
    ["getBoundingClientRect", rangeBounds],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});
afterEach(cleanup);
it("opens the actual editor search and replace panel with Chinese controls", async () => {
  await i18n.changeLanguage("zh-CN");
  const ref = createRef<CodeEditorHandle>();
  render(
    <CodeEditor
      ref={ref}
      fileName="notes.txt"
      value="hello hello"
      placeholder="编辑内容"
      onChange={vi.fn()}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
    />,
  );
  act(() => ref.current!.openSearchPanel());
  expect(screen.getByRole("textbox", { name: "查找" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "替换为" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "区分大小写" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "正则表达式" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "全部替换" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "关闭搜索" })).toBeTruthy();
});

it("replaces matches and retains undo and redo in the real editor", async () => {
  await i18n.changeLanguage("zh-CN");
  const ref = createRef<CodeEditorHandle>(),
    changed = vi.fn();
  const { container } = render(
    <CodeEditor
      ref={ref}
      fileName="notes.txt"
      value="hello hello"
      placeholder="编辑内容"
      onChange={changed}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
    />,
  );
  act(() => ref.current!.openSearchPanel());
  fireEvent.change(screen.getByRole("textbox", { name: "查找" }), {
    target: { value: "hello" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), {
    target: { value: "同舟" },
  });
  fireEvent.click(screen.getByRole("button", { name: "全部替换" }));
  await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toBe("同舟 同舟"));
  const content = container.querySelector(".cm-content")!;
  fireEvent.keyDown(content, { key: "z", code: "KeyZ", ctrlKey: true });
  await waitFor(() =>
    expect(changed.mock.calls.at(-1)?.[0]).toBe("hello hello"),
  );
  fireEvent.keyDown(content, { key: "y", code: "KeyY", ctrlKey: true });
  await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toBe("同舟 同舟"));
});
it("updates an open search panel when the application language changes", async () => {
  await i18n.changeLanguage("zh-CN");
  const ref = createRef<CodeEditorHandle>();
  render(
    <CodeEditor
      ref={ref}
      fileName="notes.txt"
      value="hello hello"
      placeholder=""
      onChange={vi.fn()}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
    />,
  );
  act(() => ref.current!.openSearchPanel());
  fireEvent.change(screen.getByRole("textbox", { name: "查找" }), {
    target: { value: "hello" },
  });
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  await screen.findByRole("textbox", { name: "Find" });
  expect(
    (screen.getByRole("textbox", { name: "Find" }) as HTMLInputElement).value,
  ).toBe("hello");
});
it("opens the replace controls with Ctrl+H", async () => {
  await i18n.changeLanguage("zh-CN");
  const { container } = render(
    <CodeEditor
      fileName="notes.txt"
      value="hello"
      placeholder=""
      onChange={vi.fn()}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
    />,
  );
  expect(screen.queryByRole("textbox", { name: "替换为" })).toBeNull();
  fireEvent.keyDown(container.querySelector(".cm-content")!, {
    key: "h",
    code: "KeyH",
    ctrlKey: true,
  });
  expect(await screen.findByRole("textbox", { name: "替换为" })).toBeTruthy();
});
