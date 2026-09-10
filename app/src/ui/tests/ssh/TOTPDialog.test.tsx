import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "@/locales/translated/zh_CN.json";
import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog";
afterEach(cleanup);
it("uses a password field and preserves long whitespace-sensitive keyboard responses", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
  });
  const submit = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TOTPDialog
        isOpen
        prompt="Password:"
        mode="password"
        onSubmit={submit}
        onCancel={() => {}}
      />
    </I18nextProvider>,
  );
  const input = view.container.querySelector("input")!;
  expect(input).toHaveAttribute("type", "password");
  expect(input.maxLength === -1 || input.maxLength > 8).toBe(true);
  expect(input).not.toHaveAttribute("pattern", "[0-9]*");
  fireEvent.change(input, { target: { value: "  longer than eight  " } });
  fireEvent.click(screen.getByRole("button", { name: "验证" }));
  expect(submit).toHaveBeenCalledWith("  longer than eight  ");
});
