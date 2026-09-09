import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { KeybindingsDialog } from "@/sidebar/KeybindingsDialog";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  snippets: vi.fn(),
}));
vi.mock("@/api/open-tabs-api", () => ({
  getUserPreferences: api.read,
  parseCustomKeybindings: (raw: string) => JSON.parse(raw),
}));
vi.mock("@/main-axios", () => ({
  saveUserPreferences: api.save,
  getSnippets: api.snippets,
}));
const entry = {
  id: "imported",
  combo: {
    key: "k",
    isCode: false,
    ctrl: true,
    shift: true,
    alt: false,
    meta: false,
  },
  action: { type: "sendText", text: "printf ready", appendEnter: false },
  enabled: false,
  needsReview: true,
  createdAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("zh-CN");
  api.read.mockResolvedValue({ customKeybindings: JSON.stringify([entry]) });
  api.save.mockResolvedValue(undefined);
  api.snippets.mockResolvedValue([{ id: 7, name: "当前工作区片段" }]);
});
afterEach(cleanup);
it("shows imported shortcuts disabled and enables only after editing and saving", async () => {
  render(<KeybindingsDialog open onOpenChange={() => {}} />);
  await screen.findByText("从备份恢复，待编辑确认；目前已禁用");
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "编辑快捷键 Ctrl + Shift + K" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "编辑快捷方式" });
  expect(within(dialog).getByDisplayValue("printf ready")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "保存快捷方式" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  const rows = JSON.parse(api.save.mock.calls[0][0].customKeybindings);
  expect(rows[0]).toMatchObject({
    id: "imported",
    enabled: true,
    action: { type: "sendText", text: "printf ready" },
  });
  expect(rows[0].needsReview).toBeUndefined();
});
it("requires explicit current-workspace snippet selection before saving an imported binding", async () => {
  api.read.mockResolvedValue({
    customKeybindings: JSON.stringify([
      { ...entry, action: { type: "runSnippet", snippetId: "" } },
    ]),
  });
  render(<KeybindingsDialog open onOpenChange={() => {}} />);
  await screen.findByText(/未找到命令片段/);
  fireEvent.click(
    screen.getByRole("button", { name: "编辑快捷键 Ctrl + Shift + K" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "编辑快捷方式" });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存快捷方式" }));
  expect(api.save).not.toHaveBeenCalled();
  const selects = within(dialog).getAllByRole("combobox");
  fireEvent.change(selects[1], { target: { value: "7" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存快捷方式" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(
    JSON.parse(api.save.mock.calls[0][0].customKeybindings)[0],
  ).toMatchObject({
    enabled: true,
    action: { type: "runSnippet", snippetId: "7" },
  });
});
