import "@testing-library/jest-dom/vitest";
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
import { UpdateCenter } from "@/updates/UpdateCenter";
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
afterEach(() => {
  cleanup();
  localStorage.removeItem("disableUpdateCheck");
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: undefined,
  });
});
function fixture(disabled = false) {
  localStorage.setItem("disableUpdateCheck", String(disabled));
  const action = vi.fn(async () => ({
    ok: true,
    value: {
      currentVersion: "0.1.0-alpha.1",
      status: "current",
      installed: true,
      releaseUrl:
        "https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.1",
      automaticChecks: !disabled,
      checkIntervalMinutes: 20,
    },
  }));
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { updates: { action } },
  });
  render(<UpdateCenter />);
  return action;
}
it("enables main-process checks and explains the twenty-minute interval in Chinese", async () => {
  await i18n.changeLanguage("zh-CN");
  const action = fixture();
  await waitFor(() => expect(action).toHaveBeenCalledWith("auto-check-on"));
  act(() => window.dispatchEvent(new Event("tandem-open-updates")));
  await screen.findByText(
    "启动时检查，运行期间每 20 分钟检查一次。下载和安装由你确认。",
  );
  expect(action).not.toHaveBeenCalledWith("download");
  expect(action).not.toHaveBeenCalledWith("install");
});
it("disables automatic checks without disabling the manual check button", async () => {
  await i18n.changeLanguage("zh-CN");
  const action = fixture(true);
  await waitFor(() => expect(action).toHaveBeenCalledWith("auto-check-off"));
  act(() => window.dispatchEvent(new Event("tandem-open-updates")));
  await screen.findByText("自动检查已关闭，仍可手动检查版本。");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("tandem.updates.check") }),
  );
  await waitFor(() => expect(action).toHaveBeenCalledWith("check"));
});
