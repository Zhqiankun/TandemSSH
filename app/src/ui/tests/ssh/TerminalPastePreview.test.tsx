import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { TerminalPastePreview } from "../../features/terminal/TerminalPastePreview";
afterEach(cleanup);
it("shows exact multiline text and Chinese explicit confirmation", async () => {
  await i18n.changeLanguage("zh-CN");
  const confirm = vi.fn(),
    cancel = vi.fn();
  const text = "echo '<script>test</script>'\npwd\n";
  const view = render(
    <TerminalPastePreview
      text={text}
      target="生产主机"
      stale={false}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(text);
  expect(document.querySelector("script")).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认粘贴" }));
  expect(confirm).toHaveBeenCalledOnce();
  view.rerender(
    <TerminalPastePreview
      text={text}
      target="生产主机"
      stale
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "确认粘贴" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("连接已变化");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(cancel).toHaveBeenCalledOnce();
});
