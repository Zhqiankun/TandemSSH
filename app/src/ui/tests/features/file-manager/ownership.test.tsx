import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { OwnershipEditor } from "@/features/file-manager/components/OwnershipEditor";
afterEach(cleanup);
it("validates numeric IDs and preserves inputs after failed save", async () => {
  await i18n.changeLanguage("zh-CN");
  const save = vi.fn(async () => {
      throw Error("denied");
    }),
    saved = vi.fn();
  render(
    <OwnershipEditor
      owner="1000"
      group="1000"
      disabled={false}
      onSave={save}
      onBusyChange={() => {}}
      onSaved={saved}
    />,
  );
  fireEvent.change(screen.getByLabelText("所有者 UID"), {
    target: { value: "root" },
  });
  expect(screen.getByRole("button", { name: "保存所有者/组" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("所有者 UID"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存所有者/组" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("刷新文件属性"),
  );
  expect(save).toHaveBeenCalledWith(0, 1000);
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("所有者 UID")).toHaveValue("0");
});
it("blocks duplicate submissions while saving", async () => {
  await i18n.changeLanguage("zh-CN");
  let finish!: () => void;
  const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
    saved = vi.fn();
  render(
    <OwnershipEditor
      owner="1000"
      group="1000"
      disabled={false}
      onSave={save}
      onBusyChange={() => {}}
      onSaved={saved}
    />,
  );
  const button = screen.getByRole("button", { name: "保存所有者/组" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
});
