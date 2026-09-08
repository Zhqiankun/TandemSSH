import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const base = fileURLToPath(
  new URL("../../.cache/conpty-runtime-tests/", import.meta.url),
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = fs.realpathSync(root),
      allowed = fs.realpathSync(base);
    if (!resolved.startsWith(allowed + path.sep))
      throw Error("Unowned runtime test directory");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
function fixture() {
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "package-"));
  roots.push(root);
  const app = path.join(root, "app"),
    pkg = path.join(app, "node_modules", "node-pty");
  fs.mkdirSync(path.join(app, "scripts"), { recursive: true });
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "node-pty", version: "1.1.0" }),
  );
  const script = path.join(app, "scripts", "prepare-conpty-runtime.cjs");
  fs.copyFileSync(
    fileURLToPath(new URL("./prepare-conpty-runtime.cjs", import.meta.url)),
    script,
  );
  const write = (relative: string, text: string) => {
    const file = path.join(pkg, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const run = () =>
    spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: app,
      timeout: 10000,
    });
  return { root, pkg, write, run };
}
describe.runIf(process.platform === "win32")("packaged ConPTY runtime", () => {
  it("copies runtime files beside a rebuilt addon without deleting other build output", () => {
    const f = fixture();
    f.write("build/Release/conpty.node", "native-addon");
    f.write("build/Release/keep.txt", "keep");
    const source = "third_party/conpty/locked-version/win10-" + process.arch;
    f.write(source + "/conpty.dll", "locked-dll");
    f.write(source + "/OpenConsole.exe", "locked-host");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(
      fs.readFileSync(
        path.join(f.pkg, "build/Release/conpty/conpty.dll"),
        "utf8",
      ),
    ).toBe("locked-dll");
    expect(
      fs.readFileSync(
        path.join(f.pkg, "build/Release/conpty/OpenConsole.exe"),
        "utf8",
      ),
    ).toBe("locked-host");
    expect(
      fs.readFileSync(path.join(f.pkg, "build/Release/keep.txt"), "utf8"),
    ).toBe("keep");
    expect(
      fs.readFileSync(path.join(f.pkg, "build/Release/conpty.node"), "utf8"),
    ).toBe("native-addon");
  });
  it("verifies an existing prebuilt runtime without inventing a rebuilt addon", () => {
    const f = fixture(),
      prebuilt = "prebuilds/win32-" + process.arch + "/conpty/";
    f.write(prebuilt + "conpty.dll", "dll");
    f.write(prebuilt + "OpenConsole.exe", "host");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(f.pkg, "build"))).toBe(false);
  });
  it("refuses to copy into a substituted runtime directory", () => {
    const f = fixture();
    f.write("build/Release/conpty.node", "native-addon");
    const source = "third_party/conpty/locked-version/win10-" + process.arch;
    f.write(source + "/conpty.dll", "dll");
    f.write(source + "/OpenConsole.exe", "host");
    const outside = path.join(f.root, "other-files");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "sentinel"), "unchanged");
    fs.symlinkSync(
      outside,
      path.join(f.pkg, "build/Release/conpty"),
      "junction",
    );
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected ConPTY runtime directory");
    expect(fs.readdirSync(outside)).toEqual(["sentinel"]);
  });
  it("fails clearly if a required runtime file is absent", () => {
    const f = fixture();
    f.write("prebuilds/win32-" + process.arch + "/conpty/conpty.dll", "dll");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OpenConsole.exe");
  });
});
