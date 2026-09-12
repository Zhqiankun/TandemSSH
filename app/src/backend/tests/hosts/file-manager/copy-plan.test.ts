import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createCopyPlan } from "../../../hosts/file-manager/copy-plan.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tandem-copy-test-"));
  roots.push(root);
  const run = (command: string) =>
    spawnSync(
      process.env.TANDEM_TEST_BASH ?? "bash",
      ["--noprofile", "--norc", "-c", command],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
  return { root, run };
}

it.each(["file", "directory"])(
  "copies a %s with literal special characters and cleans staging",
  (kind) => {
    const { root, run } = fixture();
    const source = "中文 ' $(touch injected) file";
    const contents = Buffer.from(
      Array.from({ length: 1024 }, (_, i) => i % 256),
    );
    if (kind === "directory") mkdirSync(join(root, source));
    writeFileSync(
      join(root, source, ...(kind === "directory" ? ["child"] : [])),
      contents,
    );
    const plan = createCopyPlan(source, ".");
    const result = run(plan.command);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(
        join(root, plan.targetPath, ...(kind === "directory" ? ["child"] : [])),
      ),
    ).toEqual(contents);
    expect(existsSync(join(root, source))).toBe(true);
    expect(existsSync(join(root, plan.stagingPath))).toBe(false);
    expect(existsSync(join(root, "injected"))).toBe(false);
  },
);

it.each([
  ["file", "file"],
  ["file", "directory"],
  ["directory", "file"],
  ["directory", "directory"],
])(
  "does not replace or merge %s into an existing %s",
  (sourceKind, targetKind) => {
    const { root, run } = fixture();
    if (sourceKind === "directory") mkdirSync(join(root, "source"));
    writeFileSync(
      join(root, "source", ...(sourceKind === "directory" ? ["child"] : [])),
      "source-bytes",
    );
    const plan = createCopyPlan("source", ".");
    if (targetKind === "directory") mkdirSync(join(root, plan.targetPath));
    const existing = join(
      root,
      plan.targetPath,
      ...(targetKind === "directory" ? ["keep"] : []),
    );
    writeFileSync(existing, "existing-bytes");
    const result = run(plan.command);
    expect(result.status, result.stderr).toBe(73);
    expect(readFileSync(existing, "utf8")).toBe("existing-bytes");
    if (targetKind === "directory")
      expect(readdirSync(join(root, plan.targetPath))).toEqual(["keep"]);
    expect(existsSync(join(root, plan.stagingPath))).toBe(false);
  },
);

it("detects a destination created immediately before mv even when mv -n exits zero", () => {
  const { root, run } = fixture();
  writeFileSync(join(root, "source"), "source");
  const plan = createCopyPlan("source", ".");
  const result = run(
    'mv() { printf "%s" other-writer > "$target"; command mv "$@"; }\n' +
      plan.command,
  );
  expect(result.status, result.stderr).toBe(73);
  expect(readFileSync(join(root, plan.targetPath), "utf8")).toBe(
    "other-writer",
  );
  expect(readFileSync(join(root, "source"), "utf8")).toBe("source");
  expect(existsSync(join(root, plan.stagingPath))).toBe(false);
});

it("never cleans a staging directory it did not create", () => {
  const { root, run } = fixture();
  const plan = createCopyPlan("source", ".");
  mkdirSync(join(root, plan.stagingPath));
  writeFileSync(join(root, plan.stagingPath, "keep"), "other-operation");
  expect(run(plan.command).status).toBe(1);
  expect(readFileSync(join(root, plan.stagingPath, "keep"), "utf8")).toBe(
    "other-operation",
  );
});

it("does not publish an incomplete copy when cp fails", () => {
  const { root, run } = fixture();
  const plan = createCopyPlan("source", ".");
  const result = run(
    'cp() { printf partial > "$stage/item"; return 1; }\n' + plan.command,
  );
  expect(result.status).toBe(1);
  expect(existsSync(join(root, plan.targetPath))).toBe(false);
  expect(existsSync(join(root, plan.stagingPath))).toBe(false);
});

it("bounds the generated UTF-8 filename without splitting characters", () => {
  const plan = createCopyPlan("界".repeat(85), ".");
  expect(Buffer.byteLength(plan.uniqueName, "utf8")).toBeLessThanOrEqual(255);
  expect(plan.uniqueName).toMatch(/^界+_copy_[0-9a-f-]{36}$/);
});
