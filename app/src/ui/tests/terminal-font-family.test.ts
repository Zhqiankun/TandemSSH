import { expect, it } from "vitest";
import {
  resolveTerminalFontFamily,
  TERMINAL_FONTS,
} from "@/lib/terminal-themes";
it("keeps named presets and empty input on their existing fallback stacks", () => {
  expect(resolveTerminalFontFamily(TERMINAL_FONTS[0].value)).toBe(
    TERMINAL_FONTS[0].fallback,
  );
  expect(resolveTerminalFontFamily("  ")).toBe(TERMINAL_FONTS[0].fallback);
});
it("keeps custom names literal instead of breaking out of their CSS string", () => {
  expect(resolveTerminalFontFamily('  Missing "Font"\\Name  ')).toBe(
    '"Missing \\22 Font\\22 \\5c Name", "SF Mono", Consolas, "Liberation Mono", monospace',
  );
});
it("preserves ordinary Unicode custom names and quotes commas as part of the name", () => {
  expect(resolveTerminalFontFamily("中文字体, Mono")).toBe(
    '"中文字体, Mono", "SF Mono", Consolas, "Liberation Mono", monospace',
  );
});
it("escapes CSS string control characters", () => {
  expect(resolveTerminalFontFamily("A\nB\rC\fD")).toBe(
    '"A\\a B\\d C\\c D", "SF Mono", Consolas, "Liberation Mono", monospace',
  );
});
