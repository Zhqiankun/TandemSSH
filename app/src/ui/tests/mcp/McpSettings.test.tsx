import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "../../i18n/i18n";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  hosts: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  configuration: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/api/mcp-api", () => ({
  mcpApi: mocks,
  codexMcpConfiguration: () => "[mcp_servers.tandemssh]\ncommand = test\n",
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: mocks.copy }));
import { McpSettings } from "../../features/mcp/McpSettings";
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  mocks.status.mockResolvedValue({ clients: [] });
  mocks.hosts.mockResolvedValue([
    { id: 7, name: "测试主机", address: "127.0.0.1", port: 22 },
  ]);
  mocks.create.mockResolvedValue({
    client: {
      id: "paired",
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
      enabled: true,
      createdAt: 0,
    },
    configuration: { command: "app", args: [], env: {} },
  });
  mocks.revoke.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(true);
});
afterEach(cleanup);
describe("Chinese MCP pairing settings", () => {
  it("creates only the selected host scope and keeps manual terminal reading off by default", async () => {
    render(<McpSettings hostId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 接入" }));
    await screen.findByText("测试主机");
    expect(
      (
        screen.getByRole("checkbox", {
          name: /允许读取已有终端内容/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "创建配对" }));
    await screen.findByRole("button", { name: "复制配置" });
    expect(mocks.create).toHaveBeenCalledWith({
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "复制配置" }));
    await screen.findByRole("button", { name: "已复制" });
    expect(mocks.copy).toHaveBeenCalledWith(
      expect.stringContaining("mcp_servers.tandemssh"),
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销 Codex 的配对" }));
    await screen.findByText("已撤销");
    expect(mocks.revoke).toHaveBeenCalledWith("paired");
  });
  it("requires an explicit host selection from general user settings", async () => {
    render(<McpSettings />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 接入" }));
    await screen.findByText("测试主机");
    expect(
      (screen.getByRole("button", { name: "创建配对" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /测试主机/ }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "创建配对" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
