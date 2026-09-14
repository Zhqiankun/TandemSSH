import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ encoding: "utf-8" }));
vi.mock("@/features/FullScreenAppWrapper.tsx", () => ({
  FullScreenAppWrapper: ({ children }: { children: (host: unknown, phase: string) => import("react").ReactNode }) =>
    children(
      { id: 1, name: "测试", terminalConfig: { encoding: state.encoding } },
      "ready",
    ),
}));
vi.mock("@/components/connection/ConnectionScreen.tsx", () => ({
  ConnectionScreen: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/features/terminal/Terminal.tsx", () => ({
  Terminal: ({ executeCommand }: { executeCommand?: string }) => (
    <div data-testid="terminal" data-command={executeCommand} />
  ),
}));
import TerminalApp from "@/features/terminal/TerminalApp";
import i18n from "@/i18n/i18n";
afterEach(cleanup);
beforeEach(async () => {
  state.encoding = "utf-8";
  await i18n.changeLanguage("zh-CN");
});
it.each(["big5", "gb18030", "shift_jis"])(
  "blocks managed tmux on %s with actionable Chinese",
  (encoding) => {
    state.encoding = encoding;
    render(<TerminalApp hostId="1" tmuxSession="test" />);
    expect(screen.getByText(/应用内 tmux 连接需要 UTF-8/)).toBeVisible();
    expect(screen.queryByTestId("terminal")).not.toBeInTheDocument();
  },
);
it("preserves ordinary legacy-encoding terminal access", () => {
  state.encoding = "big5";
  render(<TerminalApp hostId="1" />);
  expect(screen.getByTestId("terminal")).toBeInTheDocument();
});
it("preserves UTF-8 explicit tmux attachment", () => {
  render(<TerminalApp hostId="1" tmuxSession="demo" />);
  expect(screen.getByTestId("terminal")).toHaveAttribute(
    "data-command",
    "tmux attach-session -t '=demo'",
  );
});
