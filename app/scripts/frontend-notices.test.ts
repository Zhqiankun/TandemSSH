import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectFrontendNotices } from "./frontend-notices";
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "tandem-frontend-notices-"),
  );
  roots.push(root);
  return root;
}
function pkg(root: string, folder: string, license?: Buffer | string) {
  const dir = path.join(root, "node_modules", folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: folder, version: "1.2.3", license: "MIT" }),
  );
  if (license !== undefined)
    fs.writeFileSync(path.join(dir, "LICENSE"), license);
  return path.join(dir, "index.js");
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("tandem-frontend-notices-")
    )
      throw Error("Unexpected cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("includes only emitted package owners, preserves original text and is deterministic", () => {
  const root = fixture();
  const first = pkg(root, "@fixture/a", "Copyright 原文\nMIT test fixture\n"),
    second = pkg(root, "b", "Second notice");
  pkg(root, "unused", "Unused notice");
  const a = collectFrontendNotices(root, [
    first,
    second,
    first + "?commonjs-proxy",
    path.join(root, "src/main.ts"),
    "\0virtual",
  ]);
  expect(a).toEqual(collectFrontendNotices(root, [second, first]));
  expect(a.inventory.packageCount).toBe(2);
  expect(a.text).toContain("Copyright 原文\nMIT test fixture\n");
  expect(a.text).not.toContain("Unused notice");
  expect(JSON.stringify(a)).not.toContain(root);
  expect(a.inventory.packages[0].notices[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});
it("distinguishes nested package versions and flags missing or undecodable notices", () => {
  const root = fixture();
  const a = pkg(root, "a"),
    b = pkg(root, "a/node_modules/b", Buffer.from([0xff]));
  const result = collectFrontendNotices(root, [a, b]);
  expect(result.inventory.packageCount).toBe(2);
  expect(
    result.inventory.packages.find((p) => p.name === "a")?.reviewItems,
  ).toContain("NOTICE_TEXT_MISSING");
  expect(
    result.inventory.packages.find((p) => p.name.endsWith("/b"))?.reviewItems,
  ).toContain("NOTICE_NOT_UTF8:LICENSE");
});
it("fails on unavailable metadata instead of silently omitting a bundled dependency", () => {
  const root = fixture();
  expect(() =>
    collectFrontendNotices(root, [
      path.join(root, "node_modules/missing/index.js"),
    ]),
  ).toThrow();
});
it("rejects dependencies outside the project", () => {
  const root = fixture(),
    other = fixture();
  const file = pkg(other, "outside", "notice");
  expect(() => collectFrontendNotices(root, [file])).toThrow("outside project");
});
it("changes evidence when a notice changes", () => {
  const root = fixture(),
    file = pkg(root, "a", "before");
  const a = collectFrontendNotices(root, [file]);
  fs.writeFileSync(path.join(path.dirname(file), "LICENSE"), "after");
  expect(collectFrontendNotices(root, [file])).not.toEqual(a);
});
it("binds notices to final on-disk bytes rather than intermediate chunk code", async () => {
  const { frontendNotices } = await import("./frontend-notices");
  const root = fixture(),
    id = pkg(root, "fixture", "Original notice");
  const directory = path.join(root, "dist");
  fs.mkdirSync(path.join(directory, "assets"), { recursive: true });
  const plugin = frontendNotices();
  (plugin.configResolved as (config: { root: string }) => void)({ root });
  const bundle = {
    main: {
      type: "chunk",
      fileName: "assets/main.js",
      code: "intermediate",
      modules: { [id]: {} },
    },
  };
  Object.assign(bundle, {
    worker: {
      type: "asset",
      fileName: "assets/pdf.worker.mjs",
      source: "worker source",
    },
    styles: { type: "asset", fileName: "assets/styles.css", source: "styles" },
  });
  fs.writeFileSync(
    path.join(directory, "assets/pdf.worker.mjs"),
    "final worker",
  );
  const generate = plugin.generateBundle as (
    this: { emitFile: (asset: { fileName: string; source: string }) => void },
    options: object,
    bundle: object,
  ) => void;
  generate.call(
    {
      emitFile(asset) {
        const target = path.join(directory, asset.fileName);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, asset.source);
      },
    },
    {},
    bundle,
  );
  fs.writeFileSync(path.join(directory, "assets/main.js"), "final output");
  (
    plugin.writeBundle as {
      handler: (options: { dir: string }, bundle: object) => void;
    }
  ).handler({ dir: directory }, bundle);
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join(directory, "notices/frontend/inventory.json"),
      "utf8",
    ),
  );
  expect(inventory.chunks[0].bytes).toBe(Buffer.byteLength("final output"));
  const { createRequire } = await import("node:module");
  const { verifyFrontendNoticeContents } = createRequire(import.meta.url)(
    "./verify-frontend-notices.cjs",
  );
  expect(
    verifyFrontendNoticeContents((file: string) =>
      fs.readFileSync(path.join(root, file)),
    ),
  ).toEqual({ packages: 1, chunks: 2, reviewItems: 0 });
  fs.writeFileSync(
    path.join(directory, "assets/pdf.worker.mjs"),
    "changed worker",
  );
  expect(() =>
    verifyFrontendNoticeContents((file: string) =>
      fs.readFileSync(path.join(root, file)),
    ),
  ).toThrow("digest mismatch");
});
it("includes only exact-version supplemental originals and refuses tampering", async () => {
  const { createHash } = await import("node:crypto");
  const root = fixture(),
    id = pkg(root, "fixture");
  const folder = path.join(root, "packaging/dependency-notices");
  fs.mkdirSync(folder, { recursive: true });
  const text = Buffer.from("Pinned original notice\n");
  fs.writeFileSync(path.join(folder, "fixture.txt"), text);
  const entry = {
    name: "fixture",
    version: "1.2.3",
    file: "fixture.txt",
    sha256: createHash("sha256").update(text).digest("hex"),
    source: { kind: "fixture", commit: "pinned" },
  };
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, entries: [entry] }),
    );
  write();
  const result = collectFrontendNotices(root, [id]);
  expect(result.text).toContain(text.toString());
  expect(result.inventory.packages[0].reviewItems).toEqual([]);
  expect(result.inventory.packages[0].notices[0]).toMatchObject({
    origin: "supplemental",
    provenance: entry.source,
  });
  entry.version = "9.9.9";
  write();
  expect(
    collectFrontendNotices(root, [id]).inventory.packages[0].reviewItems,
  ).toContain("NOTICE_TEXT_MISSING");
  entry.version = "1.2.3";
  write();
  fs.writeFileSync(path.join(folder, "fixture.txt"), "changed");
  expect(() => collectFrontendNotices(root, [id])).toThrow("digest mismatch");
});
