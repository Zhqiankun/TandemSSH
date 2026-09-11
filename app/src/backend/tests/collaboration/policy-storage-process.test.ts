import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
it("persists policy through the real encrypted desktop database across processes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-policy-db-"));
  const key = randomBytes(32).toString("hex");
  const helper = fileURLToPath(
    new URL("../../test-helpers/policy-storage-child.ts", import.meta.url),
  );
  const results = [];
  try {
    for (const mode of ["write", "read"]) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", helper, mode],
        {
          cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
          env: {
            ...process.env,
            DATA_DIR: directory,
            DATABASE_DIALECT: "sqlite",
            DB_FILE_ENCRYPTION: "true",
            DATABASE_KEY: key,
          },
          encoding: "utf8",
          timeout: 45000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      if (result.status !== 0)
        throw Error(
          "Policy storage child failed: " +
            (result.stderr || result.stdout).slice(-2000),
        );
      const line = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("POLICY_STORAGE_RESULT "));
      expect(line).toBeTruthy();
      results.push(JSON.parse(line!.slice("POLICY_STORAGE_RESULT ".length)));
      const file = fs.readFileSync(path.join(directory, "db.sqlite.encrypted"));
      expect(file.includes(Buffer.from("tandem-policy:fixture-owner"))).toBe(
        false,
      );
    }
    expect(
      results.map((r) => ({
        mode: r.mode,
        revision: r.revision,
        outcome: r.outcome,
      })),
    ).toEqual([
      { mode: "write", revision: 7, outcome: "deny" },
      { mode: "read", revision: 7, outcome: "deny" },
    ]);
  } finally {
    const resolved = fs.realpathSync(directory);
    expect(path.dirname(resolved)).toBe(fs.realpathSync(os.tmpdir()));
    expect(path.basename(resolved)).toMatch(/^tandem-policy-db-[A-Za-z0-9]+$/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}, 100000);
