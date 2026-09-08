import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SystemPairingSecretStore } from "../../mcp/credential-store.js";

describe("MCP pairing reference boundary", () => {
  it("refuses references outside its fixed credential namespace", async () => {
    const store = new SystemPairingSecretStore();
    await expect(
      store.read({ profileId: "../other-app", clientId: randomUUID() }),
    ).rejects.toThrow("INVALID_PAIRING_REFERENCE");
  });
  it.runIf(process.platform === "win32")(
    "round-trips and deletes only a new test credential in the Windows store",
    async () => {
      const store = new SystemPairingSecretStore();
      const reference = { profileId: randomUUID(), clientId: randomUUID() };
      const secret = randomBytes(32);
      let created = false;
      await expect(store.read(reference)).rejects.toThrow(
        "MCP_PAIRING_NOT_FOUND",
      );
      try {
        await store.write(reference, secret);
        created = true;
        expect(Buffer.from(await store.read(reference)).equals(secret)).toBe(
          true,
        );
        expect(await store.remove(reference)).toBe(true);
        created = false;
        await expect(store.read(reference)).rejects.toThrow(
          "MCP_PAIRING_NOT_FOUND",
        );
      } finally {
        if (created) await store.remove(reference);
        secret.fill(0);
      }
    },
  );
});
