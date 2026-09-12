import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/i18n/ui-text", () => ({ translateUiText: (text: string) => text }));
import { terminalParentPath } from "../../../features/file-manager/file-terminal-path";
import { FileManagerContextMenu } from "../../../features/file-manager/FileManagerContextMenu";
afterEach(cleanup);
it.each([
  ["/file", "/"],
  ["/srv/file", "/srv"],
  ["/C:/file", "/C:/"],
  ["C:\\file", "C:/"],
  ["/srv/back\\slash/file", "/srv/back\\slash"],
])("resolves the terminal parent of %s", (value, expected) => {
  expect(terminalParentPath(value)).toBe(expected);
});
it("opens a root-level file's directory rather than an empty default path", () => {
  const open = vi.fn();
  render(
    <FileManagerContextMenu
      x={20}
      y={20}
      isVisible
      files={[{ name: "file", type: "file", path: "/file" }]}
      onClose={vi.fn()}
      onOpenTerminal={open}
    />,
  );
  fireEvent.click(screen.getByText("fileManager.openTerminalInFileLocation"));
  expect(open).toHaveBeenCalledWith("/");
});
