import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { SudoPasswordDialog } from "@/features/file-manager/SudoPasswordDialog";
afterEach(cleanup);
const setup = async (submit: (password: string) => Promise<void>) => {
  await i18n.changeLanguage("zh-CN");
  const change = vi.fn();
  const view = render(
    <SudoPasswordDialog open onSubmit={submit} onOpenChange={change} />,
  );
  return { ...view, change };
};
it("unlocks the password form after a rejected request and permits retry", async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(Error("private native error"))
    .mockResolvedValue(undefined);
  await setup(submit);
  const input = screen.getByPlaceholderText("Sudo 密码");
  fireEvent.change(input, { target: { value: "  exact password  " } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("private native error")).toBeNull();
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit).toHaveBeenLastCalledWith("  exact password  ");
});
it("keeps cancel available and ignores an old completion after reopening", async () => {
  let first!: () => void, second!: () => void;
  const submit = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          first = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          second = r;
        }),
    );
  const view = await setup(submit);
  fireEvent.change(screen.getByPlaceholderText("Sudo 密码"), {
    target: { value: "first" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(view.change).toHaveBeenCalledWith(false);
  view.rerender(
    <SudoPasswordDialog
      open={false}
      onSubmit={submit}
      onOpenChange={view.change}
    />,
  );
  view.rerender(
    <SudoPasswordDialog open onSubmit={submit} onOpenChange={view.change} />,
  );
  const input = screen.getByPlaceholderText("Sudo 密码");
  expect((input as HTMLInputElement).value).toBe("");
  fireEvent.change(input, { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await act(async () => first());
  expect(input.hasAttribute("disabled")).toBe(true);
  await act(async () => second());
  expect(input.hasAttribute("disabled")).toBe(false);
});
