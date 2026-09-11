import { describe, expect, it } from "vitest";

import {
  buildDeleteCommand,
  fileCommandSucceeded,
} from "../../../hosts/file-manager/operation-commands.js";

describe("buildDeleteCommand", () => {
  it("builds a PowerShell 5.1 compatible delete command for Windows files", () => {
    const command = buildDeleteCommand(
      "/C:/Users/Administrator/test.txt",
      false,
    );

    expect(command.command).toBe(
      "Remove-Item -LiteralPath 'C:\\Users\\Administrator\\test.txt' -Force -ErrorAction Stop",
    );
    expect(command.commandWithSuccess).toBe(
      `${command.command}; if ($?) { Write-Output "SUCCESS" }`,
    );
    expect(command.commandWithSuccess).not.toContain("&&");
  });

  it("adds recursive deletion for Windows directories", () => {
    const command = buildDeleteCommand("C:/Temp/Folder", true);

    expect(command.command).toBe(
      "Remove-Item -LiteralPath 'C:\\Temp\\Folder' -Recurse -Force -ErrorAction Stop",
    );
  });

  it("escapes single quotes in Windows literal paths", () => {
    const command = buildDeleteCommand("/C:/Temp/O'Brien.txt", false);

    expect(command.command).toBe(
      "Remove-Item -LiteralPath 'C:\\Temp\\O''Brien.txt' -Force -ErrorAction Stop",
    );
  });

  it("keeps POSIX delete commands using shell success chaining", () => {
    const command = buildDeleteCommand("/tmp/O'Brien.txt", false);

    expect(command.command).toBe("rm -f -- '/tmp/O'\"'\"'Brien.txt'");
    expect(command.commandWithSuccess).toBe(
      `${command.command} && echo "SUCCESS"`,
    );
  });
});

it("requires an actual zero exit and, for framed deletes, a standalone success marker", () => {
  for (const code of [null, undefined, 1, 126, 127]) {
    expect(fileCommandSucceeded(code)).toBe(false);
    expect(fileCommandSucceeded(code, "SUCCESS\n")).toBe(false);
  }
  expect(fileCommandSucceeded(0)).toBe(true);
  expect(fileCommandSucceeded(0, "SUCCESS\r\n")).toBe(true);
  expect(fileCommandSucceeded(0, "not SUCCESS")).toBe(false);
});

it("keeps option-like names literal and rejects invalid deletion paths", () => {
  expect(buildDeleteCommand("--no-preserve-root", false).command).toBe(
    "rm -f -- '--no-preserve-root'",
  );
  expect(buildDeleteCommand("-rf", true).command).toBe("rm -rf -- '-rf'");
  for (const path of ["", "a\0b", null, 42])
    expect(() => buildDeleteCommand(path as never, false)).toThrow(
      "INVALID_FILE_PATH",
    );
});
