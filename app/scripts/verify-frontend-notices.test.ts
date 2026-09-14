import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const {
  verifyFrontendNoticeContents,
} = require("./verify-frontend-notices.cjs");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function fixture() {
  const text = Buffer.from("Original notice\n"),
    code = Buffer.from("console.log('fixture');");
  const inventory = {
    schemaVersion: 1,
    scope: "emitted-javascript-modules",
    packageCount: 1,
    packages: [
      {
        name: "fixture",
        version: "1.0.0",
        reviewItems: ["NOTICE_TEXT_MISSING"],
      },
    ],
    noticesSha256: sha(text),
    chunks: [
      { file: "assets/main-a.js", bytes: code.length, sha256: sha(code) },
    ],
  };
  const files = new Map([
    ["dist/notices/frontend/THIRD-PARTY-NOTICES.txt", text],
    ["dist/assets/main-a.js", code],
  ]);
  const read = (file: string) => {
    if (file === "dist/notices/frontend/inventory.json")
      return Buffer.from(JSON.stringify(inventory));
    const bytes = files.get(file);
    if (!bytes) throw Error("Missing packaged artifact");
    return bytes;
  };
  return { inventory, files, read };
}
it("verifies real artifact bytes while retaining unresolved review items", () => {
  const f = fixture();
  expect(verifyFrontendNoticeContents(f.read)).toEqual({
    packages: 1,
    chunks: 1,
    reviewItems: 1,
  });
});
it.each([
  "dist/notices/frontend/THIRD-PARTY-NOTICES.txt",
  "dist/assets/main-a.js",
])("rejects missing or changed %s", (file) => {
  const f = fixture();
  f.files.set(file, Buffer.from("changed"));
  expect(() => verifyFrontendNoticeContents(f.read)).toThrow("digest mismatch");
  f.files.delete(file);
  expect(() => verifyFrontendNoticeContents(f.read)).toThrow("Missing");
});
it.each([
  "../outside.js",
  "/outside.js",
  "assets/../../outside.js",
  "assets\\outside.js",
  "C:/outside.js",
  "assets//main.js",
])("rejects unsafe archive entry %s", (file) => {
  const f = fixture();
  f.inventory.chunks[0].file = file;
  expect(() => verifyFrontendNoticeContents(f.read)).toThrow("entry invalid");
});
it("rejects empty and duplicated chunk lists", () => {
  const f = fixture();
  f.inventory.chunks.push(f.inventory.chunks[0]);
  expect(() => verifyFrontendNoticeContents(f.read)).toThrow("entry invalid");
  f.inventory.chunks = [];
  expect(() => verifyFrontendNoticeContents(f.read)).toThrow("incomplete");
});
