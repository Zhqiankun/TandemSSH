import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { C2STunnelPresetManager } from "@/user/C2STunnelPresetManager";
const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: messages }));
vi.mock("@/main-axios.ts", () => ({
  getSSHHosts: async () => [
    { id: 7, name: "本机测试", ip: "127.0.0.1", port: 22, username: "fixture" },
  ],
  getC2STunnelPresets: async () => [],
  createC2STunnelPreset: vi.fn(),
  deleteC2STunnelPreset: vi.fn(),
  updateC2STunnelPreset: vi.fn(),
}));
const config = {
  scope: "c2s",
  displayName: "取消验证",
  sourceHostId: 7,
  sourceHostName: "本机测试",
  sourceIdentity: { ip: "127.0.0.1", port: 22, username: "fixture" },
  relayOrigin: "local",
  sourcePort: 23000,
  endpointPort: 22,
  mode: "local",
  bindHost: "127.0.0.1",
  autoStart: false,
};
let resolvePending: (value: unknown) => void;
let start: ReturnType<typeof vi.fn>,
  test: ReturnType<typeof vi.fn>,
  stop: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  messages.success.mockClear();
  messages.error.mockClear();
  const pending = new Promise((resolve) => {
    resolvePending = resolve;
  });
  start = vi.fn(() => pending);
  test = vi.fn(() => pending);
  stop = vi.fn(async () => ({ success: true }));
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      isElectron: true,
      getC2STunnelConfig: async () => [config],
      getC2STunnelPresetDefaultName: async () => "",
      getC2STunnelStatuses: async () => ({}),
      onC2STunnelStatuses: () => () => {},
      startC2STunnel: start,
      testC2STunnel: test,
      stopC2STunnel: stop,
    },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: undefined,
  });
});
for (const action of ["启动", "测试"])
  it(`cancels pending ${action} and ignores its late successful result`, async () => {
    render(<C2STunnelPresetManager />);
    fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
    fireEvent.click(screen.getByRole("button", { name: action }));
    const cancel = await screen.findByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    expect(screen.getByDisplayValue("23000")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "删除 取消验证" }),
    ).toBeDisabled();
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith(
        "c2s::0::7::local::127.0.0.1::23000::22",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "启动" })).toBeEnabled(),
    );
    expect(screen.getByDisplayValue("23000")).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除 取消验证" })).toBeEnabled();
    const completed = messages.success.mock.calls.length;
    await act(async () => {
      resolvePending({ success: true });
    });
    expect(messages.success).toHaveBeenCalledTimes(completed);
    expect(messages.error).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument();
  });
