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

it("appends disabled shortcuts and writes selected appearance in the same receipt", async () => {
  const f = await fixture();
  const old = {
    id: "existing",
    combo: {
      key: "c",
      isCode: false,
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    },
    action: { type: "copy" },
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
  await adapter.run(
    sql`INSERT INTO user_preferences(user_id,theme,custom_keybindings) VALUES ('owner','dark',${JSON.stringify([old])})`,
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.appearance = {
    theme: "nord",
    fontSize: "lg",
    accentColor: "#123456",
  };
  f.request.payload.keybindings = [
    {
      ref: randomUUID(),
      combo: old.combo,
      action: { type: "runSnippet", snippetRef: "7" },
      originalEnabled: true,
    },
  ];
  const request = {
    ...f.request,
    restorePreferences: true,
    restoreKeybindings: true,
  };
  const result = await f.repo.apply("owner", request);
  expect(result.keybindingsImported).toBe(1);
  expect(result.desktopConfiguration?.appearance?.theme).toBe("nord");
  const rows = await adapter.query<{
    theme: string;
    custom_keybindings: string;
  }>(
    sql`SELECT theme,custom_keybindings FROM user_preferences WHERE user_id='owner'`,
  );
  const keys = JSON.parse(rows[0].custom_keybindings);
  expect(rows[0].theme).toBe("nord");
  expect(keys[0]).toEqual(old);
  expect(keys[1]).toMatchObject({
    enabled: false,
    needsReview: true,
    action: { type: "runSnippet", snippetId: "" },
  });
  expect(await f.repo.apply("owner", request)).toEqual(result);
  expect((await f.repo.snapshot("owner")).hosts).toHaveLength(1);
});
it("rolls back hosts and preferences if shortcut import exceeds the target limit", async () => {
  const f = await fixture();
  await adapter.run(
    sql`INSERT INTO user_preferences(user_id,theme,custom_keybindings) VALUES ('owner','dark',${JSON.stringify(Array.from({ length: 200 }, (_, id) => ({ id: String(id) })))})`,
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.keybindings = [
    {
      ref: randomUUID(),
      combo: {
        key: "c",
        isCode: false,
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
      },
      action: { type: "copy" },
      originalEnabled: true,
    },
  ];
  f.request.payload.appearance = { theme: "nord" };
  await expect(
    f.repo.apply("owner", {
      ...f.request,
      restorePreferences: true,
      restoreKeybindings: true,
    }),
  ).rejects.toThrow("BACKUP_KEYBINDING_LIMIT");
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
  expect(await adapter.query(sql`SELECT * FROM ui_preferences`)).toHaveLength(
    0,
  );
  expect(
    (
      await adapter.query<{ theme: string }>(
        sql`SELECT theme FROM user_preferences`,
      )
    )[0].theme,
  ).toBe("dark");
});
it("restores network references and inactive C2S presets atomically and idempotently", async () => {
  const f = await fixture(),
    source = f.request.payload.hosts[0];
  const target = { ...source, ref: randomUUID(), name: "target" };
  f.request.payload.hosts.push(target);
  source.network = {
    jumpHostRefs: [target.ref],
    tunnels: [
      {
        scope: "s2s",
        mode: "remote",
        sourceHostRef: source.ref,
        endpointHostRef: target.ref,
        bindHost: "127.0.0.1",
        sourcePort: 9000,
        endpointPort: 22,
        maxRetries: 2,
        retryInterval: 5000,
      },
    ],
  };
  f.request.payload.tunnelPresets = [
    {
      ref: randomUUID(),
      name: "client",
      tunnels: [
        {
          scope: "c2s",
          mode: "dynamic",
          sourceHostRef: source.ref,
          bindHost: "127.0.0.1",
          sourcePort: 1080,
          endpointPort: 0,
          maxRetries: 0,
          retryInterval: 5000,
        },
      ],
    },
  ];
  const result = await f.repo.apply("owner", f.request),
    again = await f.repo.apply("owner", f.request);
  expect(again).toEqual(result);
  expect(result.tunnelPresetIds).toHaveLength(1);
  const rows = await adapter.query<{
    id: number;
    jump_hosts: string;
    tunnel_connections: string;
    enable_tunnel: number;
  }>(
    sql`SELECT id,jump_hosts,tunnel_connections,enable_tunnel FROM ssh_data WHERE user_id='owner' ORDER BY id`,
  );
  expect(rows).toHaveLength(2);
  expect(JSON.parse(rows[0].jump_hosts)).toEqual([
    { hostId: result.hostIds[1] },
  ]);
  expect(JSON.parse(rows[0].tunnel_connections)[0]).toMatchObject({
    endpointHost: String(result.hostIds[1]),
    autoStart: false,
  });
  expect(rows[0].enable_tunnel).toBe(0);
  const presets = await adapter.query<{
    config: string;
    platform: string | null;
    computer_name: string | null;
  }>(
    sql`SELECT config,platform,computer_name FROM c2s_tunnel_presets WHERE user_id='owner'`,
  );
  expect(presets).toHaveLength(1);
  expect(JSON.parse(presets[0].config)[0]).toMatchObject({
    sourceHostId: result.hostIds[0],
    autoStart: false,
  });
  expect(presets[0].platform).toBeNull();
  expect(presets[0].computer_name).toBeNull();
  expect((await f.repo.snapshot("other")).tunnelPresets).toHaveLength(0);
});
it("invalidates a preview after C2S configuration changes", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO c2s_tunnel_presets (user_id,name,config) VALUES ('owner','changed','[]')",
  );
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "BACKUP_CONFIGURATION_CHANGED",
  );
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
});
it("rolls back hosts when preset restoration fails", async () => {
  const f = await fixture();
  f.request.payload.tunnelPresets = [
    { ref: randomUUID(), name: "fail-preset", tunnels: [] },
  ];
  await adapter.exec(
    "CREATE TRIGGER fail_preset BEFORE INSERT ON c2s_tunnel_presets BEGIN SELECT RAISE(ABORT, 'preset-failed'); END;",
  );
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "preset-failed",
  );
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
});
it("restores host appearance always, but user defaults and themes only with preference consent", async () => {
  const f = await fixture();
  f.request.payload.hosts[0].terminalAppearance = {
    fontSize: 19,
    theme: "nord",
  };
  f.request.payload.terminalDefaults = { fontSize: 18, scrollback: 5000 };
  const first = await f.repo.apply("owner", f.request);
  expect(first.preferencesRestored).toBe(false);
  let snapshot = await f.repo.snapshot("owner");
  expect(JSON.parse(snapshot.hosts[0].terminalConfig as string)).toMatchObject({
    fontSize: 19,
    theme: "nord",
  });
  expect(snapshot.terminalDefaults).toBeUndefined();
  const second = await f.repo.apply("owner", {
    ...f.request,
    id: randomUUID(),
    fingerprint: snapshot.fingerprint,
    restorePreferences: true,
  });
  expect(second.preferencesRestored).toBe(true);
  snapshot = await f.repo.snapshot("owner");
  expect(JSON.parse(snapshot.terminalDefaults!)).toEqual({
    fontSize: 18,
    scrollback: 5000,
  });
});
it("invalidates the import preview when terminal defaults change", async () => {
  const f = await fixture();
  await adapter.exec(
    `INSERT INTO user_preferences (user_id,terminal_defaults) VALUES ('owner','{"fontSize":20}')`,
  );
  await expect(f.repo.apply("owner", f.request)).rejects.toThrow(
    "BACKUP_CONFIGURATION_CHANGED",
  );
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
});
it("rolls back imported hosts if the requested theme library would exceed its limit", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO user_preferences (user_id,custom_themes) VALUES ('owner','[]')",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  const colors = {
    background: "#000",
    foreground: "#fff",
    black: "#000",
    red: "#a00",
    green: "#0a0",
    yellow: "#aa0",
    blue: "#00a",
    magenta: "#a0a",
    cyan: "#0aa",
    white: "#aaa",
    brightBlack: "#555",
    brightRed: "#f55",
    brightGreen: "#5f5",
    brightYellow: "#ff5",
    brightBlue: "#55f",
    brightMagenta: "#f5f",
    brightCyan: "#5ff",
    brightWhite: "#fff",
  };
  const existing = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    name: "old-" + i,
    colors,
  }));
  await adapter.exec(
    "UPDATE user_preferences SET custom_themes='" +
      JSON.stringify(existing) +
      "' WHERE user_id='owner'",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.terminalThemes = Array.from({ length: 1 }, () => ({
    ref: randomUUID(),
    name: "theme",
    colors,
  }));
  await expect(
    f.repo.apply("owner", { ...f.request, restorePreferences: true }),
  ).rejects.toThrow("BACKUP_TERMINAL_THEME_LIMIT");
  expect(await adapter.query(sql`SELECT id FROM ssh_data`)).toHaveLength(0);
});
it("appends a valid theme once and preserves its generated identity on confirmation retries", async () => {
  const f = await fixture();
  const colors = {
    background: "#000",
    foreground: "#fff",
    black: "#000",
    red: "#a00",
    green: "#0a0",
    yellow: "#aa0",
    blue: "#00a",
    magenta: "#a0a",
    cyan: "#0aa",
    white: "#aaa",
    brightBlack: "#555",
    brightRed: "#f55",
    brightGreen: "#5f5",
    brightYellow: "#ff5",
    brightBlue: "#55f",
    brightMagenta: "#f5f",
    brightCyan: "#5ff",
    brightWhite: "#fff",
  };
  f.request.payload.terminalThemes = [
    { ref: randomUUID(), name: "saved-theme", colors },
  ];
  const request = { ...f.request, restorePreferences: true };
  const first = await f.repo.apply("owner", request),
    before = (await f.repo.snapshot("owner")).customThemes;
  expect(first.terminalThemesImported).toBe(1);
  expect(await f.repo.apply("owner", request)).toEqual(first);
  expect((await f.repo.snapshot("owner")).customThemes).toBe(before);
  expect(JSON.parse(before!)[0].id).not.toBe(
    f.request.payload.terminalThemes[0].ref,
  );
});
it("keeps imported rule and startup fields inert through preview and real database restore", async () => {
  const { ConfigurationBackupService } =
    await import("../../../configuration-backup/service.js");
  const f = await fixture();
  const policy = JSON.stringify({
    revision: 7,
    sets: [
      {
        id: "deny",
        scope: { type: "global" },
        strictAllowlist: true,
        rules: [
          {
            id: "deny-rm",
            effect: "deny",
            match: { kind: "program", program: "rm" },
            reason: "保留黑名单",
          },
        ],
      },
    ],
  });
  await adapter.run(
    sql`INSERT INTO settings (key,value) VALUES ('tandem-policy:owner',${policy})`,
  );
  const data = structuredClone(f.request.payload);
  Object.assign(data, {
    policy: { revision: 999, sets: [] },
    rules: [],
    runAfterImport: "touch unexpected",
  });
  Object.assign(data.hosts[0], {
    terminalConfig: { autoExecute: "touch unexpected" },
    enableTunnel: true,
    autoConnect: true,
    policy: { strictAllowlist: false },
  });
  const service = new ConfigurationBackupService({
    snapshot: (user) => f.repo.snapshot(user),
    apply: (user, request) => f.repo.apply(user, request),
    audit: async () => {},
  });
  const before = await f.repo.snapshot("owner");
  const preview = await service.previewImport("owner", JSON.stringify(data));
  expect((await f.repo.snapshot("owner")).fingerprint).toBe(before.fingerprint);
  expect(
    preview.warnings.some(
      (w) => w.code === "IGNORED_FIELD" && w.path?.endsWith(".policy"),
    ),
  ).toBe(true);
  const result = await service.apply("owner", preview.id, false);
  expect(result.hostIds).toHaveLength(1);
  const rows = await adapter.query<{ value: string }>(
    sql`SELECT value FROM settings WHERE key='tandem-policy:owner'`,
  );
  expect(rows).toEqual([{ value: policy }]);
  const hosts = await adapter.query<{
    auth_type: string;
    enable_tunnel: number;
    terminal_config: string | null;
    credential_id: number | null;
  }>(
    sql`SELECT auth_type,enable_tunnel,terminal_config,credential_id FROM ssh_data WHERE user_id='owner'`,
  );
  expect(hosts).toHaveLength(1);
  expect(hosts[0]).toMatchObject({
    auth_type: "unconfigured",
    enable_tunnel: 0,
    credential_id: null,
  });
  expect(hosts[0].terminal_config ?? "").not.toContain("unexpected");
  expect(JSON.stringify(await f.repo.snapshot("owner"))).not.toContain(
    "touch unexpected",
  );
});
