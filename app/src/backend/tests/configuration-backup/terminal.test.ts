import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  projectConfigurationBackup,
  parseConfigurationBackup,
} from "../../configuration-backup/schema.js";
import {
  appendTerminalThemes,
  projectTerminalAppearance,
} from "../../configuration-backup/terminal.js";
import { terminalColorsSchema } from "../../../types/terminal-appearance.js";
const colors = {
  background: "#101820",
  foreground: "#e8edf2",
  black: "#000000",
  red: "#aa0000",
  green: "#00aa00",
  yellow: "#aaaa00",
  blue: "#0000aa",
  magenta: "#aa00aa",
  cyan: "#00aaaa",
  white: "#aaaaaa",
  brightBlack: "#555555",
  brightRed: "#ff5555",
  brightGreen: "#55ff55",
  brightYellow: "#ffff55",
  brightBlue: "#5555ff",
  brightMagenta: "#ff55ff",
  brightCyan: "#55ffff",
  brightWhite: "#ffffff",
};
const host = {
  id: 1,
  ip: "10.0.0.1",
  port: 22,
  username: "fixture",
  name: "test",
};
it("projects terminal appearance, user defaults and library without startup or machine paths", () => {
  const { payload, warnings } = projectConfigurationBackup(
    [
      {
        ...host,
        terminalConfig: JSON.stringify({
          fontSize: 19,
          theme: "custom",
          customThemeColors: null,
          agentForwarding: true,
          startupSnippetId: 77,
          backgroundImage: "C:/private/image.png",
        }),
      },
    ],
    [],
    undefined,
    undefined,
    undefined,
    [],
    {
      defaults: JSON.stringify({ fontSize: 17, cursorStyle: "bar" }),
      themes: JSON.stringify([{ id: "old-theme-id", name: "夜色", colors }]),
    },
  );
  expect(payload.hosts[0].terminalAppearance).toEqual({
    fontSize: 19,
    theme: "custom",
  });
  expect(payload.terminalDefaults).toEqual({
    fontSize: 17,
    cursorStyle: "bar",
  });
  expect(payload.terminalThemes?.[0].colors).toEqual(colors);
  expect(JSON.stringify(payload)).not.toMatch(
    /agentForwarding|startupSnippetId|private\/image|old-theme-id/,
  );
  expect(warnings.some((w) => w.code === "TERMINAL_FIELDS_EXCLUDED")).toBe(
    true,
  );
});
it("preserves an explicit empty defaults object", () => {
  expect(projectTerminalAppearance("{}", [], "defaults")).toEqual({});
});
it("ignores new display fields in old versions and strictly validates v3", () => {
  const { payload } = projectConfigurationBackup([host], []);
  const input = {
    ...payload,
    version: 2,
    terminalDefaults: "old extension",
    terminalThemes: "old extension",
    hosts: [{ ...payload.hosts[0], terminalAppearance: "old extension" }],
  };
  const result = parseConfigurationBackup(input).payload;
  expect(result.terminalDefaults).toBeUndefined();
  expect(result.terminalThemes).toBeUndefined();
  expect(result.hosts[0].terminalAppearance).toBeUndefined();
  expect(() => parseConfigurationBackup({ ...input, version: 3 })).toThrow();
});
it("accepts bounded color literals but not external resources or invalid components", () => {
  expect(
    terminalColorsSchema.safeParse({
      ...colors,
      selectionBackground: "rgba(10, 20, 30, 0.5)",
      cursorAccent: "transparent",
    }).success,
  ).toBe(true);
  for (const value of [
    "url(https://fixture/secret)",
    "rgb(999,0,0)",
    "rgba(0,0,0,2)",
  ])
    expect(
      terminalColorsSchema.safeParse({ ...colors, background: value }).success,
    ).toBe(false);
});
it("appends fresh IDs and disambiguates names without mutating the existing library", () => {
  const existing = [{ id: "existing", name: "夜色", colors }],
    imported = { ref: randomUUID(), name: "夜色", colors };
  const result = appendTerminalThemes(JSON.stringify(existing), [imported]);
  expect(result[0]).toEqual(existing[0]);
  expect(result[1].name).toBe("夜色 (2)");
  expect(result[1].id).not.toBe(imported.ref);
  expect(result[1].id).not.toBe("existing");
  expect(() =>
    appendTerminalThemes(
      JSON.stringify(Array.from({ length: 100 }, () => existing[0])),
      [imported],
    ),
  ).toThrow("BACKUP_TERMINAL_THEME_LIMIT");
});

it("retains an explicit host choice to inherit user terminal appearance", () => {
  const { payload } = projectConfigurationBackup(
    [
      {
        ...host,
        terminalConfig: { inheritTerminalAppearance: true, fontSize: 15 },
      },
    ],
    [],
  );
  expect(payload.hosts[0].terminalAppearance).toEqual({
    inheritTerminalAppearance: true,
    fontSize: 15,
  });
});
