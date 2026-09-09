import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "./test-support.js";
import { ConfigurationBackupRepository } from "../../../database/repositories/configuration-backup-repository.js";
import { DataCrypto } from "../../../utils/data-crypto.js";
import { parseConfigurationBackup } from "../../../configuration-backup/schema.js";
let adapter: TestSqliteDatabase;
afterEach(async () => {
  vi.restoreAllMocks();
  await adapter?.close();
});
async function fixture(onWrite?: () => Promise<void>) {
  adapter = new TestSqliteDatabase("sqlite");
  const context = await adapter.connect();
  await adapter.exec(
    "INSERT INTO users (id,username,password_hash) VALUES ('owner','alice','hash'), ('other','bob','hash');",
  );
  vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
    Buffer.alloc(32, 7),
  );
  const repo = new ConfigurationBackupRepository(context, onWrite);
  const payload = parseConfigurationBackup({
    format: "tandemssh-configuration",
    version: 1,
    createdAt: new Date().toISOString(),
    hosts: [
      {
        ref: randomUUID(),
        name: "Imported",
        ip: "127.0.0.1",
        port: 22,
        username: "fixture",
        credentialRef: "source-credential:7",
        originalAuthType: "agent",
      },
    ],
    workflows: [
      {
        ref: randomUUID(),
        definition: {
          schemaVersion: 1,
          id: "check",
          name: "巡检",
          version: "1.0.0",
          parameters: {},
          defaults: { cwd: "/srv" },
          steps: [
            {
              id: "print",
              name: "输出",
              action: { type: "command", program: "printf", args: ["ready"] },
            },
          ],
        },
      },
    ],
    preferences: { preset: "advanced" },
  }).payload;
  return {
    repo,
    request: {
      id: randomUUID(),
      digest: "fixture-digest",
      fingerprint: (await repo.snapshot("owner")).fingerprint,
      payload,
      restorePreferences: false,
    },
  };
}
it("appends inactive hosts without credentials and workflows requiring explicit target binding", async () => {
  const f = await fixture();
  const result = await f.repo.apply("owner", f.request);
  expect(result.hostIds).toHaveLength(1);
  expect(result.preferencesRestored).toBe(false);
  const raw = await adapter.query<{
    ip: string;
    auth_type: string;
    credential_id: number | null;
    password: string | null;
    enable_tunnel: number;
    stats_config: string;
  }>(
    sql`SELECT ip,auth_type,credential_id,password,enable_tunnel,stats_config FROM ssh_data WHERE user_id='owner'`,
  );
  expect(raw[0].ip).toBe("127.0.0.1");
  expect(raw[0]).toMatchObject({
    auth_type: "unconfigured",
    credential_id: null,
    password: null,
    enable_tunnel: 0,
  });
  expect(JSON.parse(raw[0].stats_config)).toMatchObject({
    metricsEnabled: false,
    statusCheckEnabled: false,
  });
  expect((await f.repo.snapshot("owner")).hosts[0].ip).toBe("127.0.0.1");
  expect((await f.repo.snapshot("other")).hosts).toHaveLength(0);
  const rows = await adapter.query<{ value: string }>(
    sql`SELECT value FROM settings WHERE key='tandem-workflows:owner'`,
  );
  expect(JSON.parse(rows[0].value)[0]).toMatchObject({
    allowedHostIds: [],
    needsHostBinding: true,
  });
  expect(await adapter.query(sql`SELECT * FROM ui_preferences`)).toHaveLength(
    0,
  );
});
it("rolls back all host inserts when a later insert fails", async () => {
  const f = await fixture();
  f.request.payload.hosts.push({
    ...f.request.payload.hosts[0],
    ref: randomUUID(),
    name: "fail",
  });
  await adapter.exec(
    "CREATE TRIGGER fail_fixture_import BEFORE INSERT ON ssh_data WHEN NEW.name = 'fail' BEGIN SELECT RAISE(ABORT, 'fixture-write-failed'); END;",
  );
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "fixture-write-failed",
  );
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
  expect(await adapter.query(sql`SELECT key FROM settings`)).toHaveLength(0);
});
it("persists a receipt so retry after write notification failure does not duplicate data", async () => {
  const write = vi
      .fn(async () => {})
      .mockRejectedValueOnce(Error("fixture-persist-notification")),
    f = await fixture(write);
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "fixture-persist-notification",
  );
  const second = await f.repo.apply("owner", f.request),
    third = await f.repo.apply("owner", f.request);
  expect(second).toEqual(third);
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(1);
  await expect(
    f.repo.apply("owner", { ...f.request, digest: "changed" }),
  ).rejects.toThrow("BACKUP_CONFIRMATION_CHANGED");
});
it("requires a fresh preview when target configuration changes", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO ssh_data(user_id,name,ip,port,username,auth_type) VALUES ('owner','existing','localhost',22,'fixture','none');",
  );
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "BACKUP_CONFIGURATION_CHANGED",
  );
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(1);
});

it("exports an encrypted source host without putting decrypted credentials in the backup", async () => {
  const f = await fixture();
  const encrypted = DataCrypto.encryptRecord(
    "ssh_data",
    { id: 7, password: "fixture-source-password" },
    "owner",
    Buffer.alloc(32, 7),
  );
  expect(encrypted.password).not.toBe("fixture-source-password");
  await adapter.run(
    sql`INSERT INTO ssh_data(id,user_id,name,ip,port,username,auth_type,password) VALUES(7,'owner','source','localhost',22,'fixture','password',${encrypted.password})`,
  );
  const snapshot = await f.repo.snapshot("owner");
  expect(snapshot.hosts[0].password).toBe("fixture-source-password");
  const { projectConfigurationBackup } =
    await import("../../../configuration-backup/schema.js");
  expect(
    JSON.stringify(
      projectConfigurationBackup(snapshot.hosts, snapshot.workflows).payload,
    ),
  ).not.toContain("fixture-source-password");
});
it("restores preferences only when requested and keeps the target onboarding state", async () => {
  const f = await fixture();
  const { sanitizeUiPreferences } =
    await import("../../../../types/ui-preferences.js");
  const current = sanitizeUiPreferences({
    preset: "simple",
    onboarding: {
      completedVersion: 2,
      completedAt: "2026-09-10T00:00:00.000Z",
    },
  });
  await adapter.run(
    sql`INSERT INTO ui_preferences(user_id,data,updated_at) VALUES ('owner',${JSON.stringify(current)},'2026-09-10')`,
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  const result = await f.repo.apply("owner", {
    ...f.request,
    restorePreferences: true,
  });
  expect(result.preferencesRestored).toBe(true);
  const restored = (await f.repo.snapshot("owner")).preferences;
  expect(restored.preset).toBe("advanced");
  expect(restored.onboarding).toEqual(current.onboarding);
});
