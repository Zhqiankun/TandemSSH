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

it.each(["Invalid local port", "Invalid remote port", "Invalid remote target port", "Invalid client tunnel target"])("shows a Chinese explanation for %s", async error => {
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  await act(async () => resolvePending({ success: false, error }));
  await waitFor(() => expect(messages.error).toHaveBeenCalled());
  expect(JSON.stringify(messages.error.mock.calls)).toContain("转发目标或端口无效");
  expect(JSON.stringify(messages.error.mock.calls)).not.toContain(error);
  expect(screen.getByRole("button", { name: "测试" })).toBeEnabled();
});

it("explains revoked host access in Chinese without claiming the tunnel started", async () => {
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  await act(async () => resolvePending({ success: false, error: "Access denied to this host" }));
  await waitFor(() => expect(JSON.stringify(messages.error.mock.calls)).toContain("没有建立隧道所需的主机权限"));
  expect(messages.success).not.toHaveBeenCalled();
});

it.each(["local", "dynamic", "remote"] as const)("describes actual %s reconnect behavior without ineffective retry inputs", async mode => {
  window.electronAPI!.getC2STunnelConfig = async () => [{ ...config, mode }];
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  expect(screen.getByText(mode === "remote" ? /远程转发断开后不会定时自动重连/ : /此隧道不按定时器重试/)).toBeVisible();
  expect(screen.queryByText(i18n.t("tunnels.maxRetries"))).not.toBeInTheDocument();
  expect(screen.queryByText(i18n.t("tunnels.retryInterval"))).not.toBeInTheDocument();
});

it.each(["Max payload size exceeded", "C2S_MESSAGE_TOO_LARGE"])("explains oversized relay error %s in Chinese", async error => {
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  await act(async () => resolvePending({ success: false, error }));
  await waitFor(() => expect(JSON.stringify(messages.error.mock.calls)).toContain("中继消息超过大小限制"));
  expect(messages.success).not.toHaveBeenCalled();
});

it("explains the relay connection limit in Chinese", async () => {
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  await act(async () => resolvePending({ success: false, error: "C2S_CONNECTION_LIMIT" }));
  await waitFor(() => expect(JSON.stringify(messages.error.mock.calls)).toContain("中继连接数量已达上限"));
  expect(messages.success).not.toHaveBeenCalled();
});

it.each(["C2S_TUNNEL_LIMIT", "C2S_REQUEST_LIMIT"])("shows a Chinese explanation for desktop quota %s", async error => {
  render(<C2STunnelPresetManager />);
  fireEvent.click(await screen.findByRole("button", { name: /取消验证/ }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  await act(async () => resolvePending({ success: false, error }));
  await waitFor(() => expect(JSON.stringify(messages.error.mock.calls)).toContain(error === "C2S_TUNNEL_LIMIT" ? "隧道已达32个" : "在途请求已达上限"));
  expect(messages.success).not.toHaveBeenCalled();
});
