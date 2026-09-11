import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  MAX_WORKFLOW_SECRET_BYTES,
  SystemWorkflowSecretStore,
} from "../../collaboration/workflows/secrets/system-store.js";
const reference = () => ({
  profileId: randomUUID(),
  userId: randomUUID(),
  secretId: randomUUID(),
});
it("rejects malformed references before accessing the credential store", async () => {
  const store = new SystemWorkflowSecretStore();
  for (const invalid of [
    { profileId: "../other" },
    { secretId: "other" },
    { userId: "" },
    { userId: "a\nb" },
  ]) {
    await expect(
      store.use({ ...reference(), ...invalid }, async () => {
        throw Error("must not run");
      }),
    ).rejects.toThrow("INVALID_WORKFLOW_SECRET_REFERENCE");
  }
});
it.runIf(process.platform === "win32")(
  "isolates references and clears borrowed bytes after success or failure in the actual OS store",
  async () => {
    const store = new SystemWorkflowSecretStore(),
      ref = reference(),
      secret = randomBytes(MAX_WORKFLOW_SECRET_BYTES);
    let borrowed: Uint8Array | undefined;
    try {
      await store.write(ref, secret);
      await store.use(ref, async (bytes) => {
        expect(Buffer.from(bytes).equals(secret)).toBe(true);
        borrowed = bytes;
      });
      expect(borrowed!.every((byte) => byte === 0)).toBe(true);
      expect(secret.some((byte) => byte !== 0)).toBe(true);
      for (const change of [
        { userId: randomUUID() },
        { profileId: randomUUID() },
        { secretId: randomUUID() },
      ])
        await expect(
          store.use({ ...ref, ...change }, async () => {}),
        ).rejects.toThrow("WORKFLOW_SECRET_NOT_FOUND");
      await expect(
        store.use(ref, async (bytes) => {
          borrowed = bytes;
          throw Error("consumer failed");
        }),
      ).rejects.toThrow("consumer failed");
      expect(borrowed!.every((byte) => byte === 0)).toBe(true);
      await expect(store.write(ref, new Uint8Array(0))).rejects.toThrow(
        "INVALID_WORKFLOW_SECRET",
      );
      await expect(
        store.write(ref, new Uint8Array(MAX_WORKFLOW_SECRET_BYTES + 1)),
      ).rejects.toThrow("INVALID_WORKFLOW_SECRET");
      await store.use(ref, async (bytes) => {
        expect(Buffer.from(bytes).equals(secret)).toBe(true);
      });
      expect(await store.remove(ref)).toBe(true);
      await expect(store.use(ref, async () => {})).rejects.toThrow(
        "WORKFLOW_SECRET_NOT_FOUND",
      );
    } finally {
      await store.remove(ref);
      secret.fill(0);
    }
  },
);
