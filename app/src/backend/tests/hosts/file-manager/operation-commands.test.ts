import { describe, expect, it } from "vitest";

import {
  buildDeleteCommand,
  deleteResultSucceeded,
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

    expect(command.command).toBe("rm -f '/tmp/O'\"'\"'Brien.txt'");
    expect(command.commandWithSuccess).toBe(
      `${command.command} && echo "SUCCESS"`,
    );
  });
});

it("requires an actual zero exit and, for framed deletes, a standalone success marker", () => {
  for (const code of [null, undefined, 1, 126, 127]) {
    expect(deleteResultSucceeded(code)).toBe(false);
    expect(deleteResultSucceeded(code, "SUCCESS\n")).toBe(false);
  }
  expect(deleteResultSucceeded(0)).toBe(true);
  expect(deleteResultSucceeded(0, "SUCCESS\r\n")).toBe(true);
  expect(deleteResultSucceeded(0, "not SUCCESS")).toBe(false);
});
