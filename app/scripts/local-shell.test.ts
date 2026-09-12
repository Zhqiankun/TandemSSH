import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
const { resolveLocalShell, resolveLocalCwd } = createRequire(import.meta.url)(
  "../electron/local-shell.cjs",
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("selects Windows shells without treating shell selection as a command", () => {
  expect(resolveLocalShell("win32", "default", {})).toEqual({
    file: "powershell.exe",
    args: ["-NoLogo"],
  });
  expect(
    resolveLocalShell("win32", "cmd", {
      ComSpec: "C:/Windows/System32/cmd.exe",
    }),
  ).toEqual({ file: "C:/Windows/System32/cmd.exe", args: ["/d"] });
  expect(resolveLocalShell("win32", "wsl", {})).toEqual({
    file: "wsl.exe",
    args: [],
  });
  expect(() => resolveLocalShell("win32", "cmd & anything", {})).toThrow(
    "LOCAL_TERMINAL_INVALID_SHELL",
  );
  expect(resolveLocalShell("linux", "cmd", { SHELL: "/bin/fish" })).toEqual({
    file: "/bin/fish",
    args: ["-l"],
  });
});
it("uses the home default or a verified absolute directory, preserving literal path characters", () => {
  const root = mkdtempSync(join(tmpdir(), "tandem-local-cwd-"));
  roots.push(root);
  const target = join(root, "中文 ' $(literal)");
  mkdirSync(target);
  const file = join(root, "file");
  writeFileSync(file, "content");
  expect(resolveLocalCwd(undefined, root)).toBe(realpathSync.native(root));
  expect(resolveLocalCwd("", root)).toBe(realpathSync.native(root));
  expect(resolveLocalCwd(target)).toBe(realpathSync.native(target));
  expect(() => resolveLocalCwd("relative")).toThrow(
    "LOCAL_TERMINAL_INVALID_DIRECTORY",
  );
  expect(() => resolveLocalCwd(root + "\0")).toThrow(
    "LOCAL_TERMINAL_INVALID_DIRECTORY",
  );
  expect(() => resolveLocalCwd(file)).toThrow(
    "LOCAL_TERMINAL_DIRECTORY_UNAVAILABLE",
  );
  expect(() => resolveLocalCwd(join(root, "missing"))).toThrow(
    "LOCAL_TERMINAL_DIRECTORY_UNAVAILABLE",
  );
});
