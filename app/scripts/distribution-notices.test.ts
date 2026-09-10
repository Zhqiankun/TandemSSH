import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  NOTICE_FILES,
  verifyDistributionNotices,
} = require("./verify-distribution-notices.cjs");
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-notices-"));
  roots.push(root);
  for (const [source, target] of NOTICE_FILES) {
    const file = path.join(root, "resources", target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.resolve(appRoot, source), file);
  }
  return root;
}
it("packages the project license, notice and retained upstream attribution", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(appRoot, "electron-builder.json"), "utf8"),
  );
  expect(config.extraResources).toEqual(
    expect.arrayContaining([
      { from: "../LICENSE", to: "notices/LICENSE" },
      { from: "../NOTICE", to: "notices/NOTICE" },
      { from: "LICENSE", to: "notices/app/LICENSE" },
      { from: "UPSTREAM.md", to: "notices/app/UPSTREAM.md" },
    ]),
  );
  const result = verifyDistributionNotices(fixture());
  expect(result).toHaveLength(4);
  expect(
    result.every(
      (r: { bytes: number; sha256: string }) =>
        r.bytes > 0 && /^[a-f0-9]{64}$/.test(r.sha256),
    ),
  ).toBe(true);
});
it("rejects missing or modified notices rather than accepting a file name alone", () => {
  const root = fixture(),
    file = path.join(root, "resources/notices/app/LICENSE");
  fs.appendFileSync(file, "changed");
  expect(() => verifyDistributionNotices(root)).toThrow("differs from source");
  fs.unlinkSync(file);
  expect(() => verifyDistributionNotices(root)).toThrow("missing");
});
