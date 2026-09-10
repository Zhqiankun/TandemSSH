import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "@/locales/translated/zh_CN.json";
import { KeyboardInteractiveDialog } from "@/ssh/dialogs/KeyboardInteractiveDialog";
import type { SSHInteractiveChallenge } from "@/types/ssh-interactive-auth";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function fixture() {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
    interpolation: { escapeValue: false },
  });
  const challenge: SSHInteractiveChallenge = {
    id: "round-one",
    name: "SSH fixture",
    instructions: "<script>not executable</script>",
    expiresAt: Date.now() + 1000,
    prompts: [
      { index: 0, prompt: "Tenant:", echo: true },
      { index: 1, prompt: "Secret:", echo: false },
    ],
  };
  const submit = vi.fn(),
    cancel = vi.fn();
  const draw = (c = challenge, waiting = false) => (
    <I18nextProvider i18n={i18n}>
      <KeyboardInteractiveDialog
        key={c.id}
        challenge={c}
        hostLabel="测试机 · 127.0.0.1:22"
        waiting={waiting}
        onSubmit={submit}
        onCancel={cancel}
      />
    </I18nextProvider>
  );
  const view = render(draw());
  return { ...view, draw, challenge, submit, cancel };
}
it("renders server text safely and submits all responses without trimming or numeric password restrictions", async () => {
  const f = await fixture();
  expect(screen.getByRole("dialog")).toHaveTextContent("SSH 交互认证");
  expect(f.container.querySelector("script")).toBeNull();
  expect(
    screen.getByText("<script>not executable</script>"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Secret:")).toHaveAttribute("type", "password");
  fireEvent.change(screen.getByLabelText("Tenant:"), {
    target: { value: "  租户  " },
  });
  fireEvent.change(screen.getByLabelText("Secret:"), {
    target: { value: "  longer than eight  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
  expect(f.submit).toHaveBeenCalledWith(["  租户  ", "  longer than eight  "]);
  expect(screen.getByLabelText("Secret:")).toHaveValue("");
});
it("allows an explicit empty answer and clears input when the prompt ID changes", async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
  expect(f.submit).toHaveBeenCalledWith(["", ""]);
  fireEvent.change(screen.getByLabelText("Secret:"), {
    target: { value: "old secret" },
  });
  f.rerender(f.draw({ ...f.challenge, id: "round-two" }));
  expect(screen.getByLabelText("Secret:")).toHaveValue("");
});
it("keeps cancellation available while waiting and does not resubmit on a second click", async () => {
  const f = await fixture();
  f.rerender(f.draw(f.challenge, true));
  expect(screen.getByRole("button", { name: "发送回复" })).toBeDisabled();
  expect(screen.queryByLabelText("Secret:")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(f.cancel).toHaveBeenCalledOnce();
  expect(f.submit).not.toHaveBeenCalled();
});
it("disables an expired unanswered prompt and shows a Chinese timeout", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("alert")).toHaveTextContent("认证已超时");
  expect(screen.getByRole("button", { name: "发送回复" })).toBeDisabled();
  expect(f.submit).not.toHaveBeenCalled();
});
