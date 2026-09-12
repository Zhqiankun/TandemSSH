vi.mock("@/i18n/ui-text", () => ({ translateUiText: (text: string) => text }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const f = vi.hoisted(() => ({
  terminal: {
    cols: 80,
    rows: 24,
    options: {},
    reset: vi.fn(),
    write: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ref: { current: null },
  start: vi.fn(),
  close: vi.fn(),
}));
vi.mock("react-xtermjs", () => ({
  useXTerm: () => ({ instance: f.terminal, ref: f.ref }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark" }),
}));
vi.mock("@/features/terminal/terminal-theme", () => ({
  resolveTermixThemeColors: () => ({}),
}));
vi.mock("@/features/terminal/terminal-global-styles", () => ({
  ensureTerminalFontsLoaded: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { LocalTerminal } from "../../features/local-terminal/LocalTerminal";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let sequence = 0;
  f.start.mockImplementation(async (options) => ({
    sessionId: "s" + ++sequence,
    shell: options.shell === "cmd" ? "cmd.exe" : "powershell.exe",
    cwd: options.cwd || "C:/Users/fixture",
  }));
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      isElectron: true,
      getPlatform: async () => "win32",
      startLocalTerminal: f.start,
      closeLocalTerminal: f.close,
      readyLocalTerminal: async () => true,
      resizeLocalTerminal: vi.fn(),
      writeLocalTerminal: vi.fn(),
      onLocalTerminalData: () => () => {},
      onLocalTerminalExit: () => () => {},
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("edits launch settings without restarting until explicit submission", async () => {
  render(<LocalTerminal instanceId="local" isVisible={false} />);
  await screen.findByRole("button", { name: "localTerminal.restart" });
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(screen.getByText("localTerminal.localBadge")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("localTerminal.cwd"), {
    target: { value: "E:/workspace" },
  });
  fireEvent.change(screen.getByLabelText("localTerminal.shell"), {
    target: { value: "cmd" },
  });
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.close).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "localTerminal.restart" }),
  );
  await waitFor(() => expect(f.start).toHaveBeenCalledTimes(2));
  expect(f.start).toHaveBeenLastCalledWith({
    cols: 80,
    rows: 24,
    shell: "cmd",
    cwd: "E:/workspace",
  });
  expect(f.close).toHaveBeenCalledWith("s1");
  await waitFor(() =>
    expect(screen.getByTitle("cmd.exe · E:/workspace")).toBeTruthy(),
  );
});
it("shows an invalid directory error without silently falling back to the home directory", async () => {
  render(<LocalTerminal instanceId="local" isVisible={false} />);
  await screen.findByRole("button", { name: "localTerminal.restart" });
  f.start.mockRejectedValueOnce(Error("LOCAL_TERMINAL_DIRECTORY_UNAVAILABLE"));
  fireEvent.change(screen.getByLabelText("localTerminal.cwd"), {
    target: { value: "E:/missing" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "localTerminal.restart" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "localTerminal.directoryUnavailable",
  );
  expect(f.start).toHaveBeenCalledTimes(2);
});
