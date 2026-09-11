import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  collectDependencyNotices,
  writeDependencyNotices,
  verifyDependencyNotices,
} = require("./distribution-dependencies.cjs");
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "tandem-dependency-notices-"),
  );
  roots.push(root);
  fs.mkdirSync(path.join(root, "resources/app.asar.unpacked/node_modules"), {
    recursive: true,
  });
  return root;
}
function pkg(
  root: string,
  name: string,
  metadata: object,
  notice?: string | Buffer,
) {
  const dir = path.join(root, "resources/app.asar.unpacked/node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(metadata));
  if (notice !== undefined) fs.writeFileSync(path.join(dir, "LICENSE"), notice);
  return dir;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== fs.realpathSync(os.tmpdir()) &&
      !root.startsWith(os.tmpdir() + path.sep)
    )
      throw Error("Fixture cleanup boundary");
    if (!path.basename(root).startsWith("tandem-dependency-notices-"))
      throw Error("Fixture cleanup name");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("records actual scoped and nested package versions with original notice text", () => {
  const root = fixture();
  pkg(
    root,
    "@scope/a",
    { name: "@scope/a", version: "1.0.0", license: "MIT" },
    "Copyright Alpha\nPermission text\n",
  );
  pkg(
    root,
    "b",
    { name: "b", version: "2.0.0", license: "ISC" },
    "Copyright Beta\n",
  );
  pkg(
    root,
    "b/node_modules/@scope/a",
    { name: "@scope/a", version: "0.9.0", license: "BSD-2-Clause" },
    "Copyright Nested\n",
  );
  const result = collectDependencyNotices(root);
  expect(result.inventory.packageCount).toBe(3);
  expect(
    result.inventory.packages.map((p: { version: string }) => p.version),
  ).toEqual(["1.0.0", "2.0.0", "0.9.0"]);
  expect(result.text).toContain("Copyright Alpha\nPermission text\n");
  expect(result.inventory.packages[2].path).toBe("b/node_modules/@scope/a");
  writeDependencyNotices(root);
  expect(verifyDependencyNotices(root)).toEqual({
    packages: 3,
    reviewItems: 0,
  });
  expect(collectDependencyNotices(root)).toEqual(result);
});
it("reports missing declarations and notices without assigning a license", () => {
  const root = fixture();
  pkg(root, "unknown", { name: "unknown", version: "1" });
  const result = collectDependencyNotices(root);
  expect(result.inventory.packages[0]).toMatchObject({
    declaredLicense: null,
    reviewItems: ["LICENSE_DECLARATION_MISSING", "NO_TOP_LEVEL_NOTICE"],
  });
  expect(result.text).not.toContain('Declared license: "MIT"');
});
it("detects modified package declarations and notice texts after generation", () => {
  const root = fixture(),
    dir = pkg(
      root,
      "a",
      { name: "a", version: "1", license: "MIT" },
      "Original",
    );
  writeDependencyNotices(root);
  fs.appendFileSync(path.join(dir, "LICENSE"), "changed");
  expect(() => verifyDependencyNotices(root)).toThrow(
    "differs from shipped files",
  );
  writeDependencyNotices(root);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "a", version: "2", license: "ISC" }),
  );
  expect(() => verifyDependencyNotices(root)).toThrow(
    "differs from shipped files",
  );
});
it("flags non-UTF8 source instead of silently replacing original text", () => {
  const root = fixture();
  pkg(
    root,
    "a",
    { name: "a", version: "1", license: "MIT" },
    Buffer.from([0xff, 0xfe]),
  );
  expect(collectDependencyNotices(root).inventory.packages[0]).toMatchObject({
    reviewItems: ["NON_UTF8_NOTICE:LICENSE"],
    notices: [{ included: false }],
  });
});
it("rejects dependency junctions outside the package", () => {
  const root = fixture(),
    outside = fixture();
  fs.symlinkSync(
    outside,
    path.join(root, "resources/app.asar.unpacked/node_modules/escape"),
    "junction",
  );
  expect(() => collectDependencyNotices(root)).toThrow("escaped package");
});
it("runs the Windows hook for installers as well as directory packages", async () => {
  const hook = require("../packaging/build/after-pack.cjs").default;
  for (const target of ["nsis", "dir"]) {
    const root = fixture();
    pkg(root, "a", { name: "a", version: "1", license: "MIT" }, "notice");
    await hook({
      electronPlatformName: "win32",
      appOutDir: root,
      targets: [{ name: target }],
    });
    expect(verifyDependencyNotices(root).packages).toBe(1);
    expect(fs.existsSync(path.join(root, ".portable"))).toBe(target === "dir");
  }
});
