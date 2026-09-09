import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConfigurationBackupPanel } from "@/features/configuration-backup/ConfigurationBackupPanel";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  download: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/api/configuration-backup-api", () => ({
  configurationBackupApi: api,
}));
const preview = {
  id: "fixture-preview",
  direction: "import",
  expiresAt: Date.now() + 300000,
  bytes: 40,
  content: '{"hosts":[],"workflows":[]}',
  hosts: [],
  workflows: [],
  hasPreferences: true,
  warnings: [{ code: "NO_AUTOMATIC_EXECUTION", path: "backup" }],
};
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  await i18n.changeLanguage("zh-CN");
  api.previewImport.mockResolvedValue(preview);
  api.previewExport.mockResolvedValue({ ...preview, direction: "export" });
  api.apply.mockResolvedValue({
    receiptId: "fixture-preview",
    hostIds: [1],
    workflowIds: [],
    preferencesRestored: false,
  });
});
afterEach(cleanup);
function select() {
  const file = new File(['{"fixture":true}'], "backup.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => '{"fixture":true}',
  });
  fireEvent.change(screen.getByLabelText("选择备份文件"), {
    target: { files: [file] },
  });
}
it("shows Chinese exact-content preview and requires confirmation with preferences off by default", async () => {
  render(<ConfigurationBackupPanel />);
  select();
  await screen.findByText("导入预览");
  expect(screen.getByLabelText("查看备份的完整内容")).toHaveValue(
    preview.content,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(api.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await screen.findByText("已新增 1 台主机、0 个流程。");
  expect(api.apply).toHaveBeenCalledWith("fixture-preview", false, false);
});
it("clears the old preview if reading the next backup fails", async () => {
  render(<ConfigurationBackupPanel />);
  select();
  await screen.findByText("导入预览");
  api.previewImport.mockRejectedValueOnce(Error("BACKUP_INVALID"));
  select();
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "确认并导入" }),
  ).not.toBeInTheDocument();
  expect(api.apply).not.toHaveBeenCalled();
});
it("does not download when export is only previewed or cancelled", async () => {
  render(<ConfigurationBackupPanel />);
  fireEvent.click(screen.getByRole("button", { name: "预览导出" }));
  await screen.findByText("导出预览");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(screen.queryByText("导出预览")).not.toBeInTheDocument(),
  );
  expect(api.download).not.toHaveBeenCalled();
});

it("sends the live local display preferences to the export preview", async () => {
  localStorage.setItem("vite-ui-theme", "nord");
  localStorage.setItem("termix-font-size", "lg");
  render(<ConfigurationBackupPanel />);
  fireEvent.click(screen.getByRole("button", { name: "预览导出" }));
  await screen.findByText("导出预览");
  expect(api.previewExport).toHaveBeenCalledWith(
    expect.objectContaining({
      appearance: expect.objectContaining({ theme: "nord", fontSize: "lg" }),
    }),
  );
});
it("keeps shortcut restore separate from interface preference restore", async () => {
  api.previewImport.mockResolvedValue({ ...preview, keybindingsCount: 2 });
  render(<ConfigurationBackupPanel />);
  select();
  await screen.findByText("导入预览");
  expect(
    screen
      .getAllByRole("checkbox")
      .every((box) => !(box as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText("恢复自定义快捷键（先禁用，编辑确认后启用）"),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await waitFor(() =>
    expect(api.apply).toHaveBeenCalledWith("fixture-preview", false, true),
  );
});
it("refuses to overwrite display settings changed after preview", async () => {
  render(<ConfigurationBackupPanel />);
  select();
  await screen.findByText("导入预览");
  fireEvent.click(screen.getByRole("checkbox"));
  localStorage.setItem("vite-ui-theme", "nord");
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await screen.findByText("预览后本地界面设置发生了变化，请重新预览。");
  expect(api.apply).not.toHaveBeenCalled();
});
it("retries only local settings after a storage failure and does not repeat database import", async () => {
  localStorage.setItem("vite-ui-theme", "dark");
  api.apply.mockResolvedValue({
    receiptId: "fixture-preview",
    hostIds: [1],
    workflowIds: [],
    preferencesRestored: true,
    desktopConfiguration: {
      appearance: { theme: "nord", accentColor: "#123456" },
    },
  });
  render(<ConfigurationBackupPanel />);
  select();
  await screen.findByText("导入预览");
  fireEvent.click(screen.getByRole("checkbox"));
  const original = Storage.prototype.setItem;
  const fail = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === "termix-accent" && value === "#123456")
        throw Error("quota-fixture");
      return original.call(this, key, value);
    });
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await screen.findByRole("button", { name: "重试应用界面设置" });
  expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
  expect(api.apply).toHaveBeenCalledTimes(1);
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "重试应用界面设置" }));
  await waitFor(() =>
    expect(localStorage.getItem("vite-ui-theme")).toBe("nord"),
  );
  expect(localStorage.getItem("termix-accent")).toBe("#123456");
  expect(api.apply).toHaveBeenCalledTimes(1);
});
