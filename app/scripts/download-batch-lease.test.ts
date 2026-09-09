import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DownloadBatchVault } = require("../electron/download-batch-vault.cjs");
async function removeOwned(root: string, base: string) {
  const actual = await fs.realpath(root);
  if (
    path.dirname(actual) !== base ||
    !path.basename(actual).startsWith("tandem-batch-lease-")
  )
    throw Error("Test cleanup scope");
  await fs.rm(actual, { recursive: true, force: true });
}
it("grants exactly one of two competing batch writer leases", async () => {
  const base = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(base, "tandem-batch-lease-"));
  const a = new DownloadBatchVault({ root, crypto: {} }),
    b = new DownloadBatchVault({ root, crypto: {} });
  try {
    for (let i = 0; i < 24; i++) {
      const results = await Promise.allSettled([
        a.lease("owner"),
        b.lease("owner"),
      ]);
      const winners = results.filter(
        (r): r is PromiseFulfilledResult<() => Promise<void>> =>
          r.status === "fulfilled",
      );
      try {
        expect(winners).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      } finally {
        for (const result of winners) await result.value();
      }
    }
  } finally {
    await removeOwned(root, base);
  }
}, 15000);
