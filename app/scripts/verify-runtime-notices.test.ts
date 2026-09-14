import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { verifyRuntimeNotices } = createRequire(import.meta.url)(
  "./verify-runtime-notices.cjs",
);
const owned: string[] = [];
afterEach(() => {
  for (const root of owned.splice(0)) {
    if (!path.basename(root).startsWith("tandem-runtime-notices-"))
      throw Error("Fixture scope");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const base = fs.mkdtempSync(
    path.join(os.tmpdir(), "tandem-runtime-notices-"),
  );
  owned.push(base);
  const sourceRoot = path.join(base, "source"),
    root = path.join(base, "package");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(sourceRoot, "version"), "1.2.3");
  for (const [source, target, text] of [
    ["LICENSE", "LICENSE.electron.txt", "runtime notice"],
    [
      "LICENSES.chromium.html",
      "LICENSES.chromium.html",
      "<html>third-party notices</html>",
    ],
  ]) {
    fs.writeFileSync(path.join(sourceRoot, source), text);
    fs.writeFileSync(path.join(root, target), text);
  }
  return {
    base,
    root,
    sourceRoot,
    options: { sourceRoot, runtimeVersion: "1.2.3" },
  };
}
it("verifies both exact notices against the running version", async () => {
  const f = fixture(),
    r = await verifyRuntimeNotices(f.root, f.options);
  expect(r.runtimeVersion).toBe("1.2.3");
  expect(r.notices).toHaveLength(2);
  expect(
    r.notices.every((n: { sha256: string }) => /^[a-f0-9]{64}$/.test(n.sha256)),
  ).toBe(true);
});
it.each(["LICENSE.electron.txt", "LICENSES.chromium.html"])(
  "rejects missing %s",
  async (file) => {
    const f = fixture();
    fs.unlinkSync(path.join(f.root, file));
    await expect(verifyRuntimeNotices(f.root, f.options)).rejects.toThrow();
  },
);
it.each(["LICENSE.electron.txt", "LICENSES.chromium.html"])(
  "rejects altered %s",
  async (file) => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, file), "changed");
    await expect(verifyRuntimeNotices(f.root, f.options)).rejects.toThrow(
      "differs from source",
    );
  },
);
it("rejects a different runtime version", async () => {
  const f = fixture();
  await expect(
    verifyRuntimeNotices(f.root, { ...f.options, runtimeVersion: "1.2.4" }),
  ).rejects.toThrow("version mismatch");
});
it("rejects an empty source notice even if the package matches", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, "LICENSE.electron.txt"), "");
  fs.writeFileSync(path.join(f.sourceRoot, "LICENSE"), "");
  await expect(verifyRuntimeNotices(f.root, f.options)).rejects.toThrow(
    "size invalid",
  );
});
