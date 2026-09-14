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
  pendingLocal: vi.fn(),
  completeLocal: vi.fn(),
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
  api.pendingLocal.mockResolvedValue([]);
  api.completeLocal.mockResolvedValue(undefined);
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
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
  expect(api.apply).toHaveBeenCalledWith(
    "fixture-preview",
    false,
    false,
    false,
    false,
  );
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
    expect(api.apply).toHaveBeenCalledWith(
      "fixture-preview",
      false,
      true,
      false,
      false,
    ),
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
  await screen.findByRole("button", { name: "重试本地恢复" });
  expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
  expect(api.apply).toHaveBeenCalledTimes(1);
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "重试本地恢复" }));
  await waitFor(() =>
    expect(localStorage.getItem("vite-ui-theme")).toBe("nord"),
  );
  expect(localStorage.getItem("termix-accent")).toBe("#123456");
  expect(api.apply).toHaveBeenCalledTimes(1);
});
it.each(["utf-8", "gb18030", "big5", "shift_jis"])(
  "shows the host %s encoding in Chinese before confirmation",
  async (terminalEncoding) => {
    api.previewImport.mockResolvedValue({
      ...preview,
      hosts: [
        {
          name: "恢复主机",
          ip: "127.0.0.1",
          port: 22,
          username: "fixture",
          terminalEncoding,
        },
      ],
    });
    render(<ConfigurationBackupPanel />);
    select();
    await screen.findByText("导入预览");
    expect(
      screen.getByText(
        new RegExp("终端字符编码.*" + terminalEncoding.toUpperCase()),
      ),
    ).toBeVisible();
    expect(api.apply).not.toHaveBeenCalled();
  },
);

it("keeps administrator defaults opt-in separate and shows the restore result", async () => {
  api.previewImport.mockResolvedValue({ ...preview, hasHostDefaults: true });
  api.apply.mockResolvedValue({
    receiptId: "fixture-preview",
    hostIds: [],
    workflowIds: [],
    preferencesRestored: false,
    hostDefaultsRestored: true,
  });
  render(<ConfigurationBackupPanel />);
  select();
  const option = await screen.findByRole("checkbox", {
    name: /同时恢复主机创建默认值/,
  });
  expect(option).not.toBeChecked();
  fireEvent.click(option);
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await screen.findByText(/已恢复主机创建默认值/);
  expect(api.apply).toHaveBeenCalledWith(
    "fixture-preview",
    false,
    false,
    true,
    false,
  );
});
it("shows the administrator rejection in Chinese without reporting success", async () => {
  api.previewImport.mockResolvedValue({ ...preview, hasHostDefaults: true });
  api.apply.mockRejectedValue(Error("BACKUP_ADMIN_REQUIRED"));
  render(<ConfigurationBackupPanel />);
  select();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /同时恢复主机创建默认值/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("需要管理员权限");
  expect(screen.queryByText(/已恢复主机创建默认值/)).not.toBeInTheDocument();
});

it("captures the actual local C2S file snapshot during export", async () => {
  const config = [{ scope: "c2s", sourceHostId: 7 }];
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: vi
      .fn()
      .mockResolvedValue({ config, revision: "a".repeat(64) }),
  });
  render(<ConfigurationBackupPanel />);
  fireEvent.click(screen.getByRole("button", { name: "预览导出" }));
  await screen.findByText("导出预览");
  expect(api.previewExport).toHaveBeenCalledWith(
    expect.objectContaining({ localTunnels: config }),
  );
});
it("retries local C2S persistence without repeating database import", async () => {
  const save = vi
    .fn()
    .mockResolvedValueOnce({ success: false, error: "C2S_CONFIG_WRITE_FAILED" })
    .mockResolvedValueOnce({ success: true, imported: 1 });
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: vi
      .fn()
      .mockResolvedValue({ config: [], revision: "a".repeat(64) }),
    importC2STunnelConfig: save,
  });
  api.previewImport.mockResolvedValue({ ...preview, localTunnelCount: 1 });
  const config = [{ scope: "c2s", autoStart: false, sourceHostId: 11 }];
  api.apply.mockResolvedValue({
    receiptId: "receipt",
    hostIds: [11],
    workflowIds: [],
    preferencesRestored: false,
    localTunnels: config,
  });
  render(<ConfigurationBackupPanel />);
  select();
  const checkbox = await screen.findByRole("checkbox", {
    name: /同时追加本地 C2S/,
  });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  expect(
    await screen.findByText(/数据库导入已完成，本地隧道配置尚未确认写入/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /重试本地/ }));
  await screen.findByText(/已追加本地 C2S 配置/);
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(api.apply).toHaveBeenCalledWith(
    "fixture-preview",
    false,
    false,
    false,
    true,
  );
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith({
    id: "receipt",
    revision: "a".repeat(64),
    config,
  });
});
it("rejects changed local configuration before committing the database", async () => {
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: vi
      .fn()
      .mockResolvedValueOnce({ config: [], revision: "a".repeat(64) })
      .mockResolvedValueOnce({ config: [], revision: "b".repeat(64) }),
    importC2STunnelConfig: vi.fn(),
  });
  api.previewImport.mockResolvedValue({ ...preview, localTunnelCount: 1 });
  render(<ConfigurationBackupPanel />);
  select();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /同时追加本地 C2S/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  await screen.findByRole("alert");
  expect(api.apply).not.toHaveBeenCalled();
});

it("rechecks local state only after explicit keep-and-append retry", async () => {
  const snapshot = vi
    .fn()
    .mockResolvedValueOnce({ config: [], revision: "a".repeat(64) })
    .mockResolvedValueOnce({ config: [], revision: "a".repeat(64) })
    .mockResolvedValueOnce({
      config: [{ displayName: "manual" }],
      revision: "b".repeat(64),
    });
  const save = vi
    .fn()
    .mockResolvedValueOnce({ success: false, error: "C2S_CONFIG_CHANGED" })
    .mockResolvedValueOnce({ success: true, imported: 1 });
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: snapshot,
    importC2STunnelConfig: save,
  });
  api.previewImport.mockResolvedValue({ ...preview, localTunnelCount: 1 });
  api.apply.mockResolvedValue({
    receiptId: "receipt",
    hostIds: [11],
    workflowIds: [],
    preferencesRestored: false,
    localTunnels: [{ sourceHostId: 11, autoStart: false }],
  });
  render(<ConfigurationBackupPanel />);
  select();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /同时追加本地 C2S/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
  const retry = await screen.findByRole("button", {
    name: "保留当前本地配置，重试追加",
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
  fireEvent.click(retry);
  await screen.findByText(/已追加本地 C2S 配置/);
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: "b".repeat(64) }),
  );
  expect(api.apply).toHaveBeenCalledTimes(1);
});

it("recovers a persisted local restore without reimporting hosts or old display preferences", async () => {
  const saved = {
    receiptId: "persisted",
    hostIds: [11],
    workflowIds: [],
    preferencesRestored: false,
    localTunnels: [{ sourceHostId: 11, autoStart: false }],
  };
  api.pendingLocal.mockResolvedValue([{ at: Date.now(), result: saved }]);
  const save = vi
    .fn()
    .mockResolvedValue({ success: true, replayed: true, imported: 1 });
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: vi
      .fn()
      .mockResolvedValue({ config: [], revision: "c".repeat(64) }),
    importC2STunnelConfig: save,
  });
  localStorage.setItem("vite-ui-theme", "nord");
  render(<ConfigurationBackupPanel />);
  const resume = await screen.findByRole("button", {
    name: "保留当前配置并继续",
  });
  expect(save).not.toHaveBeenCalled();
  expect(api.completeLocal).not.toHaveBeenCalled();
  fireEvent.click(resume);
  await screen.findByText(/已追加本地 C2S 配置/);
  expect(api.apply).not.toHaveBeenCalled();
  expect(api.completeLocal).toHaveBeenCalledWith("persisted");
  expect(localStorage.getItem("vite-ui-theme")).toBe("nord");
  expect(screen.queryByText("待完成的本地隧道恢复")).not.toBeInTheDocument();
});
it("keeps recovery pending when acknowledgment fails after local write", async () => {
  api.pendingLocal.mockResolvedValue([
    {
      at: Date.now(),
      result: {
        receiptId: "persisted",
        hostIds: [11],
        workflowIds: [],
        preferencesRestored: false,
        localTunnels: [{ sourceHostId: 11, autoStart: false }],
      },
    },
  ]);
  api.completeLocal.mockRejectedValueOnce(
    Error("BACKUP_LOCAL_RECOVERY_UNAVAILABLE"),
  );
  const save = vi
    .fn()
    .mockResolvedValue({ success: true, replayed: true, imported: 1 });
  vi.stubGlobal("electronAPI", {
    snapshotC2STunnelConfig: vi
      .fn()
      .mockResolvedValue({ config: [], revision: "c".repeat(64) }),
    importC2STunnelConfig: save,
  });
  render(<ConfigurationBackupPanel />);
  fireEvent.click(
    await screen.findByRole("button", { name: "保留当前配置并继续" }),
  );
  await screen.findByRole("button", { name: "重试本地恢复" });
  expect(screen.getByText("待完成的本地隧道恢复")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试本地恢复" }));
  await screen.findByText(/已追加本地 C2S 配置/);
  expect(save).toHaveBeenCalledTimes(2);
  expect(api.completeLocal).toHaveBeenCalledTimes(2);
  expect(api.apply).not.toHaveBeenCalled();
});
