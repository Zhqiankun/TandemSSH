import { aiSessionKeys } from "../../../database/repositories/ai-session-keys.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "./test-support.js";
import { AiRepository } from "../../../database/repositories/ai-repository.js";
import { DataCrypto } from "../../../utils/data-crypto.js";
import { FieldCrypto } from "../../../utils/field-crypto.js";
let db: TestSqliteDatabase, repo: AiRepository;
const input = {
  userId: "owner",
  providerType: "openai",
  label: "fixture",
  apiKey: "fixture-api-key-not-real",
};
beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  const context = await db.connect();
  await db.exec(
    "INSERT INTO users (id,username,password_hash) VALUES ('owner','alice','hash')",
  );
  vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(Buffer.alloc(32, 7));
  repo = new AiRepository(context);
});
afterEach(async () => {
  aiSessionKeys.clear();
  vi.restoreAllMocks();
  await db?.close();
});
it("never inserts the API key as plaintext, including the initial insert", async () => {
  await db.exec(
    "CREATE TRIGGER reject_plain_provider BEFORE INSERT ON ai_providers WHEN NEW.api_key IS NOT NULL AND json_valid(NEW.api_key)=0 BEGIN SELECT RAISE(ABORT,'plaintext first insert'); END",
  );
  const provider = await repo.createProvider(input);
  const rows = await db.query<{ api_key: string }>(
    sql`SELECT api_key FROM ai_providers`,
  );
  expect(rows).toHaveLength(1);
  expect(FieldCrypto.isEncrypted(rows[0].api_key)).toBe(true);
  expect(rows[0].api_key).not.toContain(input.apiKey);
  expect(provider.apiKey).toBeNull();
  expect(
    (await repo.findProviderWithSecret(provider.id, "owner"))?.apiKey,
  ).toBe(input.apiKey);
});
it.each(["missing", "throws"])(
  "refuses creation with %s encryption access without writing a provider",
  async (kind) => {
    if (kind === "missing")
      vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
    else
      vi.mocked(DataCrypto.getUserDataKey).mockImplementation(() => {
        throw Error("private crypto detail");
      });
    await expect(repo.createProvider(input)).rejects.toThrow(
      "AI_KEY_ENCRYPTION_UNAVAILABLE",
    );
    expect(await repo.listProviders("owner")).toEqual([]);
  },
);
it("refuses an unavailable-key update without changing the old secret or metadata", async () => {
  const provider = await repo.createProvider(input);
  const before = await db.query(sql`SELECT * FROM ai_providers`);
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
  await expect(
    repo.updateProvider(provider.id, "owner", {
      apiKey: "replacement-secret",
      label: "changed",
    }),
  ).rejects.toThrow("AI_KEY_ENCRYPTION_UNAVAILABLE");
  expect(await db.query(sql`SELECT * FROM ai_providers`)).toEqual(before);
});
it("does not insert a partial provider when encryption itself fails", async () => {
  vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(() => {
    throw Error("private crypto detail");
  });
  await expect(repo.createProvider(input)).rejects.toThrow(
    "AI_KEY_ENCRYPTION_FAILED",
  );
  expect(await repo.listProviders("owner")).toEqual([]);
});
it("still allows providers that do not carry an API key", async () => {
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
  const provider = await repo.createProvider({
    ...input,
    providerType: "ollama",
    apiKey: null,
  });
  expect(provider.apiKey).toBeNull();
});
it("masks short keys without persisting the complete key in the visible prefix", async () => {
  const provider = await repo.createProvider({ ...input, apiKey: "short" });
  expect(provider.apiKeyPrefix).toBe("••••");
  expect(
    (await repo.findProviderWithSecret(provider.id, "owner"))?.apiKey,
  ).toBe("short");
});
it("rejects missing decryption access and corrupted ciphertext instead of returning ciphertext as a key", async () => {
  const provider = await repo.createProvider(input);
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
  await expect(
    repo.findProviderWithSecret(provider.id, "owner"),
  ).rejects.toThrow("AI_KEY_ENCRYPTION_UNAVAILABLE");
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(Buffer.alloc(32, 8));
  await expect(
    repo.findProviderWithSecret(provider.id, "owner"),
  ).rejects.toThrow("AI_KEY_DECRYPTION_FAILED");
});
it("reads numeric-context ciphertext after rotating a pre-encrypted new provider key", async () => {
  const provider = await repo.createProvider(input);
  const updated = await repo.updateProvider(provider.id, "owner", {
    apiKey: "rotated-fixture-key",
  });
  expect(updated?.apiKey).toBeNull();
  const rows = await db.query<{ api_key: string }>(
    sql`SELECT api_key FROM ai_providers`,
  );
  expect(JSON.parse(rows[0].api_key).recordId).toBe(String(provider.id));
  expect(
    (await repo.findProviderWithSecret(provider.id, "owner"))?.apiKey,
  ).toBe("rotated-fixture-key");
  expect(await repo.findProviderWithSecret(provider.id, "other")).toBeNull();
});

it("uses a memory-only Key without requiring encryption or writing secret fields", async () => {
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
  const created = await repo.createProvider({
    ...input,
    apiKeyStorage: "memory",
  });
  expect(created).toMatchObject({
    apiKey: null,
    apiKeyStorage: "memory",
    apiKeyPrefix: "fixtur",
  });
  const stored = await db.query<{
    api_key: string | null;
    api_key_prefix: string | null;
  }>(sql`SELECT api_key,api_key_prefix FROM ai_providers`);
  expect(stored).toEqual([{ api_key: null, api_key_prefix: null }]);
  expect((await repo.findProviderWithSecret(created.id, "owner"))?.apiKey).toBe(
    input.apiKey,
  );
  expect(await repo.findProviderWithSecret(created.id, "other")).toBeNull();
  aiSessionKeys.clear("owner");
  expect(
    (await repo.findProviderWithSecret(created.id, "owner"))?.apiKey,
  ).toBeNull();
  expect((await repo.findProvider(created.id, "owner"))?.apiKeyStorage).toBe(
    "none",
  );
});
it("rotates encrypted keys to memory and clears temporary keys on endpoint changes and deletion", async () => {
  const created = await repo.createProvider(input);
  vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
  await repo.updateProvider(created.id, "owner", {
    apiKey: "temporary",
    apiKeyStorage: "memory",
  });
  expect((await repo.findProviderWithSecret(created.id, "owner"))?.apiKey).toBe(
    "temporary",
  );
  expect(
    (
      await db.query<{ api_key: string | null }>(
        sql`SELECT api_key FROM ai_providers`,
      )
    )[0].api_key,
  ).toBeNull();
  await repo.updateProvider(created.id, "owner", {
    baseUrl: "http://127.0.0.1/new",
  });
  expect(aiSessionKeys.get("owner", created.id)).toBeUndefined();
  await repo.updateProvider(created.id, "owner", {
    apiKey: "second",
    apiKeyStorage: "memory",
  });
  await repo.deleteProvider(created.id, "owner");
  expect(aiSessionKeys.get("owner", created.id)).toBeUndefined();
});
it("does not resurrect a Key if logout clears it while database persistence is pending", async () => {
  let release!: () => void,
    entered = false;
  const pending = new Promise<void>((r) => (release = r));
  const delayed = new AiRepository(await db.connect(), async () => {
    entered = true;
    await pending;
  });
  const creating = delayed.createProvider({
    ...input,
    apiKeyStorage: "memory",
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  aiSessionKeys.clear("owner");
  release();
  await expect(creating).rejects.toThrow("AI_SESSION_KEY_EXPIRED");
  const rows = await repo.listProviders("owner");
  expect(rows).toHaveLength(1);
  expect(rows[0].apiKeyStorage).toBe("none");
});
