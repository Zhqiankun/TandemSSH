import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnippetVariablesDialog } from "../../components/SnippetVariablesDialog";
import type { Snippet } from "@/types/ui-types";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
const snippet = (id = 1, content = "echo $INPUT_1") =>
  ({ id, name: "参数片段", content, folder: null, order: 0 }) as Snippet;
it("retains typed parameters across an equivalent snippet object rerender", () => {
  const confirm = vi.fn(),
    cancel = vi.fn();
  const view = render(
    <SnippetVariablesDialog
      snippet={snippet()}
      host={null}
      onCancel={cancel}
      onConfirm={confirm}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "中文参数" },
  });
  view.rerender(
    <SnippetVariablesDialog
      snippet={{ ...snippet() }}
      host={null}
      onCancel={cancel}
      onConfirm={confirm}
    />,
  );
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "中文参数",
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "newUi.sidebar.snippets.variablesConfirmButton",
    }),
  );
  expect(confirm).toHaveBeenCalledWith("echo 中文参数", {
    INPUT_1: "中文参数",
  });
});
it.each([snippet(2), snippet(1, "printf $INPUT_1")])(
  "clears old values when snippet identity or content changes",
  (changed) => {
    const view = render(
      <SnippetVariablesDialog
        snippet={snippet()}
        host={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "old value" },
    });
    view.rerender(
      <SnippetVariablesDialog
        snippet={changed}
        host={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  },
);

it.each(["Enter", "Escape"])(
  "leaves composing %s to the input method",
  (key) => {
    const confirm = vi.fn(),
      cancel = vi.fn();
    render(
      <SnippetVariablesDialog
        snippet={snippet()}
        host={null}
        onCancel={cancel}
        onConfirm={confirm}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key, isComposing: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  },
);
it("associates the generated parameter label with its input", () => {
  render(
    <SnippetVariablesDialog
      snippet={snippet()}
      host={null}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("newUi.sidebar.snippets.inputLabel")).toBe(
    screen.getByRole("textbox"),
  );
});
