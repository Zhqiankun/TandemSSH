import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { verifyFontNoticeContents } = require("./verify-font-notices.cjs");
const root = fileURLToPath(new URL("../", import.meta.url));
const notice = (file: string) =>
  fs.readFileSync(path.join(root, "packaging/font-notices", file));
const asset = (file: string) =>
  fs.readFileSync(path.join(root, file.replace(/^dist\//, "public/")));
it("ships the exact official font originals and their release notices", () => {
  expect(verifyFontNoticeContents(asset, notice)).toEqual({
    fonts: 4,
    notices: 2,
    sourceVersion: "3.4.0",
  });
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  );
  expect(config.extraResources).toContainEqual({
    from: "packaging/font-notices",
    to: "notices/fonts",
  });
});
it.each(["manifest.json", "LICENSE", "README.md"])(
  "rejects modified %s",
  (file) => {
    expect(() =>
      verifyFontNoticeContents(asset, (name: string) =>
        name === file ? Buffer.from("changed") : notice(name),
      ),
    ).toThrow(/differs|mismatch/);
  },
);
it.each(["dist/fonts/", "public/fonts/"])(
  "rejects a replaced font under %s",
  (prefix) => {
    expect(() =>
      verifyFontNoticeContents(
        (name: string) =>
          name.startsWith(prefix) ? Buffer.from("changed") : asset(name),
        notice,
      ),
    ).toThrow("Font asset digest mismatch");
  },
);
