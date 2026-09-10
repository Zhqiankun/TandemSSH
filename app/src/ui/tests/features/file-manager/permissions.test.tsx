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
import { PermissionsDialog } from "@/features/file-manager/components/PermissionsDialog";
import { parsePermissions } from "@/features/file-manager/permissions";
afterEach(cleanup);
it.each([
  ["drwxr-xr-x", 0, 7, 5, 5],
  ["drwxrwxrwt", 1, 7, 7, 7],
  ["-rwSr-sr-T", 7, 6, 5, 4],
  ["2755", 2, 7, 5, 5],
  ["644", 0, 6, 4, 4],
])(
  "parses %s without losing type or special bits",
  (mode, special, owner, group, other) => {
    expect(parsePermissions(String(mode))).toEqual({
      special,
      owner,
      group,
      other,
    });
  },
);
it("saves directory mode including sticky and explicitly clears it", async () => {
  await i18n.changeLanguage("zh-CN");
  const onSave = vi.fn(async () => {});
  const file = {
    name: "共享",
    path: "/srv/共享",
    type: "directory" as const,
    permissions: "drwxrwxrwt",
  };
  render(
    <PermissionsDialog
      file={file}
      open
      onOpenChange={() => {}}
      onSave={onSave}
    />,
  );
  expect(screen.getByDisplayValue("1777")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(file, "1777"));
  await waitFor(() =>
    expect(screen.getByLabelText("限制删除（sticky）")).toBeEnabled(),
  );
  fireEvent.click(screen.getByLabelText("限制删除（sticky）"));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(file, "0777"));
});

it("prevents overwriting unknown permissions with zero", async () => {
  await i18n.changeLanguage("zh-CN");
  const save = vi.fn();
  render(
    <PermissionsDialog
      file={{
        name: "unknown",
        path: "/unknown",
        type: "file",
        permissions: "??????????",
      }}
      open
      onOpenChange={() => {}}
      onSave={save}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("无法识别");
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
