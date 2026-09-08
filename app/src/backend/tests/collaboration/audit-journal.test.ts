import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AuditJournal } from "../../collaboration/audit/journal.js";
const workspace = path.resolve(
  import.meta.dirname,
  "../../../../../.cache/audit-tests",
);
const owned: string[] = [];
async function fixture(
  max = 100 * 1024 * 1024,
  retention = 7 * 24 * 60 * 60_000,
) {
  await fs.mkdir(workspace, { recursive: true });
  const root = await fs.mkdtemp(path.join(workspace, "journal-"));
  owned.push(root);
  const directory = path.join(
    root,
    "tandem-audit",
    createHash("sha256").update("user").digest("hex").slice(0, 24),
  );
  return {
    root,
    directory,
    journal: new AuditJournal(root, "user", max, retention),
  };
}
afterEach(async () => {
  for (const root of owned.splice(0)) {
    if (path.dirname(path.resolve(root)) !== workspace)
      throw Error("INVALID_TEST_CLEANUP");
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe("persistent redacted audit journal", () => {
  it("writes ordered valid JSON events and masks keys and assignment values", async () => {
    const f = await fixture();
    await Promise.all([
      f.journal.record("one", {
        password: "never-save-this",
        output: "API_KEY=secret123\nnormal=yes",
      }),
      f.journal.record("two", {
        output: "--password secret456",
        args: ["--api-key", "argument-secret789"],
      }),
    ]);
    const files = await fs.readdir(f.directory);
    const text = await fs.readFile(path.join(f.directory, files[0]), "utf8");
    expect(text).not.toContain("never-save-this");
    expect(text).not.toContain("secret123");
    expect(text).not.toContain("secret456");
    expect(text).not.toContain("argument-secret789");
    expect(text).toContain("normal=yes");
    expect(
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).type),
    ).toEqual(["one", "two"]);
  });
  it("prunes only owned expired shards and preserves unrelated files", async () => {
    const f = await fixture();
    await fs.mkdir(f.directory, { recursive: true });
    const old = path.join(
      f.directory,
      "record-1000000000000-" + randomUUID() + ".jsonl",
    );
    await fs.writeFile(old, "old");
    await fs.utimes(old, 0, 0);
    await fs.writeFile(path.join(f.directory, "user-notes.txt"), "keep");
    await f.journal.record("new", {});
    expect(await fs.readdir(f.directory)).not.toContain(path.basename(old));
    expect(
      await fs.readFile(path.join(f.directory, "user-notes.txt"), "utf8"),
    ).toBe("keep");
  });
  it("honors the total size cap and refuses a single oversized event", async () => {
    const f = await fixture(600);
    for (let i = 0; i < 6; i++)
      await f.journal.record("step", { text: "x".repeat(100) });
    const sizes = await Promise.all(
      (await fs.readdir(f.directory)).map(
        async (file) => (await fs.stat(path.join(f.directory, file))).size,
      ),
    );
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600);
    await expect(
      f.journal.record("large", { text: "x".repeat(1000) }),
    ).rejects.toThrow("AUDIT_EVENT_TOO_LARGE");
  });
  it("recovers the write queue after an IO failure without hiding that failure", async () => {
    const f = await fixture();
    await fs.mkdir(path.dirname(f.directory), { recursive: true });
    await fs.writeFile(f.directory, "blocked");
    await expect(f.journal.record("failed", {})).rejects.toThrow();
    await fs.unlink(f.directory);
    await f.journal.record("next", {});
    expect((await fs.readdir(f.directory)).length).toBe(1);
  });
});
