import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initialDirectoryCommand } from "../../../hosts/terminal/initial-directory.js";

it("passes POSIX path metacharacters as literal directory text to a real shell", () => {
  const root = mkdtempSync(join(tmpdir(), "tandem-initial-dir-"));
  try {
    const name = "-中文 ' $(touch injected) `touch injected2` ; &";
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "marker"), "keep");
    const result = spawnSync(
      process.env.TANDEM_TEST_BASH ?? "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        initialDirectoryCommand(name).slice(0, -1) + "\ntest -f marker",
      ],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, "injected"))).toBe(false);
    expect(existsSync(join(root, "injected2"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it.each(["a\nb", "a\rb", "a\tb", "a\0b", "a\x1bb", ""])(
  "rejects terminal control paths %j",
  (value) => {
    expect(() => initialDirectoryCommand(value)).toThrow(
      "UNSUPPORTED_TERMINAL_PATH",
    );
  },
);
it("keeps Windows spaces and drive changes literal without choosing a shell dialect", () => {
  expect(initialDirectoryCommand("/D:/中文 folder")).toBe(
    'pushd "D:\\中文 folder"\r',
  );
});
it.each(["/C:/$(whoami)", "/C:/%PATH%", "/C:/!PATH!", "/C:/`x", "/C:/[abc]"])(
  "rejects ambiguous Windows expansion %s",
  (value) => {
    expect(() => initialDirectoryCommand(value)).toThrow(
      "UNSUPPORTED_TERMINAL_PATH",
    );
  },
);

it.runIf(process.platform === "win32")(
  "enters a Windows directory literally in both native cmd and PowerShell",
  () => {
    const root = mkdtempSync(join(tmpdir(), "tandem-win-initial-"));
    try {
      const target = join(root, "中文 ' folder");
      mkdirSync(target);
      writeFileSync(join(target, "marker"), "keep");
      const command = initialDirectoryCommand(target).slice(0, -1);
      const shells: Array<[string, string[]]> = [
        [
          process.env.ComSpec || "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            '"' + command + " && if not exist marker exit /b 7" + '"',
          ],
        ],
        [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command + "; if (!(Test-Path -LiteralPath 'marker')) { exit 7 }",
          ],
        ],
      ];
      for (const [shell, args] of shells) {
        const result = spawnSync(shell, args, {
          windowsVerbatimArguments: shell.toLowerCase().endsWith("cmd.exe"),
          cwd: root,
          encoding: "utf8",
          timeout: 15000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, shell + ": " + result.stderr).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
