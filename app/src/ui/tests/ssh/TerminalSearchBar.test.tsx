import React, { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TerminalSearchBar } from "../../features/terminal/search/TerminalSearchBar";
afterEach(cleanup);
function setup() {
  const next = vi.fn(),
    previous = vi.fn(),
    close = vi.fn(),
    outer = vi.fn();
  render(
    <div onKeyDown={outer}>
      <TerminalSearchBar
        visible
        query="中文"
        onQueryChange={vi.fn()}
        onFindNext={next}
        onFindPrevious={previous}
        onClose={close}
        caseSensitive={false}
        onToggleCaseSensitive={vi.fn()}
        wholeWord={false}
        onToggleWholeWord={vi.fn()}
        regex={false}
        onToggleRegex={vi.fn()}
        resultIndex={0}
        resultCount={2}
        inputRef={createRef<HTMLInputElement>()}
      />
    </div>,
  );
  return { input: screen.getByRole("textbox"), next, previous, close, outer };
}
it("keeps Enter and Shift+Enter search navigation inside the search field", () => {
  const s = setup();
  fireEvent.keyDown(s.input, { key: "Enter" });
  fireEvent.keyDown(s.input, { key: "Enter", shiftKey: true });
  expect(s.next).toHaveBeenCalledOnce();
  expect(s.previous).toHaveBeenCalledOnce();
  expect(s.outer).not.toHaveBeenCalled();
});
it("closes on Escape without triggering parent keyboard handlers", () => {
  const s = setup();
  fireEvent.keyDown(s.input, { key: "Escape" });
  expect(s.close).toHaveBeenCalledOnce();
  expect(s.outer).not.toHaveBeenCalled();
});
it.each([
  { key: "Enter", isComposing: true },
  { key: "Escape", isComposing: true },
  { key: "Enter", keyCode: 229 },
])(
  "leaves IME confirmation and cancellation to the input method: %j",
  (event) => {
    const s = setup();
    expect(fireEvent.keyDown(s.input, event)).toBe(true);
    expect(s.next).not.toHaveBeenCalled();
    expect(s.previous).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
    expect(s.outer).not.toHaveBeenCalled();
  },
);
it("retains native clipboard shortcuts without bubbling to terminal handlers", () => {
  const s = setup();
  expect(fireEvent.keyDown(s.input, { key: "v", ctrlKey: true })).toBe(true);
  expect(s.outer).not.toHaveBeenCalled();
});
