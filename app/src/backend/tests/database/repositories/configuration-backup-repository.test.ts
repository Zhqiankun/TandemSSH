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
it.each(["utf-8", "gb18030", "big5", "shift_jis"] as const)(
  "restores host %s without user preference consent or starting connections",
  async (encoding) => {
    const f = await fixture();
    f.request.payload.hosts[0].terminalEncoding = encoding;
    f.request.payload.hosts[0].terminalAppearance = {
      inheritTerminalAppearance: true,
      fontSize: 21,
    };
    const result = await f.repo.apply("owner", f.request);
    const rows = await adapter.query<{
      terminal_config: string;
      auth_type: string;
      enable_tunnel: number;
      stats_config: string;
    }>(
      sql`SELECT terminal_config,auth_type,enable_tunnel,stats_config FROM ssh_data WHERE user_id='owner'`,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].terminal_config)).toMatchObject({
      encoding,
      inheritTerminalAppearance: true,
      fontSize: 21,
    });
    expect(rows[0]).toMatchObject({
      auth_type: "unconfigured",
      enable_tunnel: 0,
    });
    expect(JSON.parse(rows[0].stats_config)).toMatchObject({
      metricsEnabled: false,
      statusCheckEnabled: false,
    });
    expect(result.preferencesRestored).toBe(false);
    expect((await f.repo.snapshot("owner")).terminalDefaults).toBeUndefined();
    expect(await f.repo.apply("owner", f.request)).toEqual(result);
    expect(
      await adapter.query(sql`SELECT id FROM ssh_data WHERE user_id='other'`),
    ).toEqual([]);
  },
);

it.each([false, true])(
  "restores navigation only with preference consent (%s), preserving AI opt-in",
  async (restorePreferences) => {
    const f = await fixture();
    await adapter.exec(
      "INSERT INTO user_preferences(user_id,hidden_rail_tabs,ai_assistant_enabled) VALUES ('owner','[\"ai\"]',0)",
    );
    f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
    f.request.payload.appearance = { hiddenRailTabs: '["serial"]' };
    const result = await f.repo.apply("owner", {
      ...f.request,
      restorePreferences,
    });
    const rows = await adapter.query<{
      hidden_rail_tabs: string;
      ai_assistant_enabled: number;
    }>(
      sql.raw(
        "SELECT hidden_rail_tabs,ai_assistant_enabled FROM user_preferences WHERE user_id='owner'",
      ),
    );
    expect(rows[0].hidden_rail_tabs).toBe(
      restorePreferences ? '["serial"]' : '["ai"]',
    );
    expect(rows[0].ai_assistant_enabled).toBe(0);
    expect(result.desktopConfiguration?.appearance?.hiddenRailTabs).toBe(
      restorePreferences ? '["serial"]' : undefined,
    );
    expect((await f.repo.snapshot("owner")).appearance?.hiddenRailTabs).toBe(
      rows[0].hidden_rail_tabs,
    );
  },
);
it("invalidates a pending restore when navigation visibility changes", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO user_preferences(user_id,hidden_rail_tabs) VALUES ('owner','[\"ai\"]')",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  await adapter.exec(
    "UPDATE user_preferences SET hidden_rail_tabs='[\"serial\"]' WHERE user_id='owner'",
  );
  await expect(
    f.repo.apply("owner", { ...f.request, restorePreferences: true }),
  ).rejects.toThrow("BACKUP_CONFIGURATION_CHANGED");
});
it("keeps target navigation when an older backup has no visibility field", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO user_preferences(user_id,hidden_rail_tabs) VALUES ('owner','[\"ai\"]')",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.appearance = { theme: "nord" };
  await f.repo.apply("owner", { ...f.request, restorePreferences: true });
  expect((await f.repo.snapshot("owner")).appearance?.hiddenRailTabs).toBe(
    '["ai"]',
  );
});

it("exposes global defaults only in admin snapshots and rejects non-admin restoration", async () => {
  const f = await fixture();
  await adapter.exec(
    "INSERT INTO settings(key,value) VALUES ('host_defaults','{\"fontSize\":18}')",
  );
  expect((await f.repo.snapshot("owner")).hostDefaults).toBeUndefined();
  f.request.payload.hostDefaults = { fontSize: 24 };
  await expect(
    f.repo.apply("owner", { ...f.request, restoreHostDefaults: true }),
  ).rejects.toThrow("BACKUP_ADMIN_REQUIRED");
  expect(await adapter.query(sql.raw("SELECT id FROM ssh_data"))).toHaveLength(
    0,
  );
  await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
  expect((await f.repo.snapshot("owner")).hostDefaults).toEqual({
    fontSize: 18,
  });
});
it.each([false, true])(
  "restores global defaults only with independent consent (%s)",
  async (restoreHostDefaults) => {
    const f = await fixture();
    await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
    await adapter.exec(
      'INSERT INTO settings(key,value) VALUES (\'host_defaults\',\'{"fontSize":12,"socks5Password":"old-fixture","credentialId":9}\')',
    );
    f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
    f.request.payload.hostDefaults = {
      fontSize: 22,
      socks5Host: "proxy.example",
      useSocks5: true,
      enableCommandHistory: true,
    };
    const result = await f.repo.apply("owner", {
      ...f.request,
      restorePreferences: true,
      restoreHostDefaults,
    });
    const snapshot = await f.repo.snapshot("owner");
    if (restoreHostDefaults) {
      expect(snapshot.hostDefaults).toEqual({
        fontSize: 22,
        socks5Host: "proxy.example",
        useSocks5: false,
        enableCommandHistory: true,
        credentialId: null,
      });
    } else {
      expect(snapshot.hostDefaults).toEqual({
        fontSize: 12,
        socks5Password: "old-fixture",
        credentialId: 9,
      });
    }
    expect(result.hostDefaultsRestored).toBe(restoreHostDefaults);
  },
);
it("rejects admin revocation between preview and confirmation", async () => {
  const f = await fixture();
  await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.hostDefaults = { fontSize: 22 };
  await adapter.exec("UPDATE users SET is_admin=0 WHERE id='owner'");
  await expect(
    f.repo.apply("owner", { ...f.request, restoreHostDefaults: true }),
  ).rejects.toThrow("BACKUP_ADMIN_REQUIRED");
  expect(await adapter.query(sql.raw("SELECT id FROM ssh_data"))).toHaveLength(
    0,
  );
});
it("rejects changes to global defaults after preview", async () => {
  const f = await fixture();
  await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  await adapter.exec(
    "INSERT INTO settings(key,value) VALUES ('host_defaults','{\"fontSize\":18}')",
  );
  await expect(
    f.repo.apply("owner", { ...f.request, restoreHostDefaults: true }),
  ).rejects.toThrow("BACKUP_CONFIGURATION_CHANGED");
});
it("preserves global defaults for older backups", async () => {
  const f = await fixture();
  await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
  await adapter.exec(
    "INSERT INTO settings(key,value) VALUES ('host_defaults','{\"fontSize\":18}')",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  const result = await f.repo.apply("owner", {
    ...f.request,
    restoreHostDefaults: true,
  });
  expect(result.hostDefaultsRestored).toBe(false);
  expect((await f.repo.snapshot("owner")).hostDefaults).toEqual({
    fontSize: 18,
  });
});

it("rolls back global defaults and imported hosts when receipt storage fails", async () => {
  const f = await fixture();
  await adapter.exec("UPDATE users SET is_admin=1 WHERE id='owner'");
  await adapter.exec(
    "INSERT INTO settings(key,value) VALUES ('host_defaults','{\"fontSize\":18}')",
  );
  f.request.fingerprint = (await f.repo.snapshot("owner")).fingerprint;
  f.request.payload.hostDefaults = { fontSize: 22 };
  await adapter.exec(
    "CREATE TRIGGER fail_backup_receipt BEFORE INSERT ON settings WHEN NEW.key LIKE 'tandem-config-import:%' BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;",
  );
  await expect(
    f.repo.apply("owner", { ...f.request, restoreHostDefaults: true }),
  ).rejects.toThrow("receipt failure");
  expect((await f.repo.snapshot("owner")).hostDefaults).toEqual({
    fontSize: 18,
  });
  expect(await adapter.query(sql.raw("SELECT id FROM ssh_data"))).toHaveLength(
    0,
  );
});

it.each([false, true])(
  "returns local tunnel configuration only when explicitly selected (%s)",
  async (restoreLocalTunnels) => {
    const f = await fixture();
    f.request.payload.localTunnels = [
      {
        scope: "c2s",
        mode: "local",
        sourceHostRef: f.request.payload.hosts[0].ref,
        bindHost: "127.0.0.1",
        sourcePort: 8080,
        endpointPort: 80,
        maxRetries: 0,
        retryInterval: 5000,
        displayName: "本地转发",
      },
    ];
    const request = { ...f.request, restoreLocalTunnels };
    const result = await f.repo.apply("owner", request);
    expect(await f.repo.apply("owner", request)).toEqual(result);
    if (restoreLocalTunnels) {
      expect(result.localTunnels?.[0]).toMatchObject({
        sourceHostId: result.hostIds[0],
        autoStart: false,
        displayName: "本地转发",
        sourceHostName: "Imported",
      });
      expect(result.localTunnels?.[0]).not.toHaveProperty("sourceIdentity");
      expect(result.localTunnels?.[0]).not.toHaveProperty("relayOrigin");
    } else expect(result.localTunnels).toBeUndefined();
  },
);

it("persists local recovery across repository recreation and isolates users", async () => {
  const f = await fixture();
  f.request.payload.localTunnels = [
    {
      scope: "c2s",
      mode: "dynamic",
      sourceHostRef: f.request.payload.hosts[0].ref,
      bindHost: "127.0.0.1",
      sourcePort: 1080,
      endpointPort: 0,
      maxRetries: 0,
      retryInterval: 5000,
    },
  ];
  const result = await f.repo.apply("owner", {
    ...f.request,
    restoreLocalTunnels: true,
  });
  const reopened = new ConfigurationBackupRepository(await adapter.connect());
  const pending = await reopened.pendingLocal("owner");
  expect(pending).toHaveLength(1);
  expect(pending[0].result.localTunnels).toEqual(result.localTunnels);
  expect(pending[0].result.desktopConfiguration).toBeUndefined();
  expect(await reopened.pendingLocal("other")).toEqual([]);
  await expect(
    reopened.completeLocal("other", result.receiptId),
  ).rejects.toThrow("BACKUP_PREVIEW_NOT_FOUND");
  await reopened.completeLocal("owner", result.receiptId);
  await reopened.completeLocal("owner", result.receiptId);
  expect(await reopened.pendingLocal("owner")).toEqual([]);
});
it("does not prune unfinished local restores when normal receipts rotate", async () => {
  const f = await fixture();
  f.request.payload.localTunnels = [
    {
      scope: "c2s",
      mode: "dynamic",
      sourceHostRef: f.request.payload.hosts[0].ref,
      bindHost: "127.0.0.1",
      sourcePort: 1080,
      endpointPort: 0,
      maxRetries: 0,
      retryInterval: 5000,
    },
  ];
  await f.repo.apply("owner", { ...f.request, restoreLocalTunnels: true });
  for (let i = 0; i < 35; i++)
    await f.repo.apply("owner", {
      ...f.request,
      id: randomUUID(),
      digest: "rotation-" + i,
      fingerprint: (await f.repo.snapshot("owner")).fingerprint,
      payload: {
        ...f.request.payload,
        hosts: [],
        workflows: [],
        localTunnels: undefined,
      },
    });
  expect((await f.repo.pendingLocal("owner"))[0].result.receiptId).toBe(
    f.request.id,
  );
});

it("rejects another local import before writing hosts when recovery capacity is full", async () => {
  const f = await fixture();
  for (let i = 0; i < 128; i++) {
    const key = "tandem-config-import:owner:" + randomUUID();
    const value = JSON.stringify({ at: i, result: { localTunnels: [{}] } });
    await adapter.exec(
      "INSERT INTO settings(key,value) VALUES ('" + key + "','" + value + "')",
    );
  }
  f.request.payload.localTunnels = [
    {
      scope: "c2s",
      mode: "dynamic",
      sourceHostRef: f.request.payload.hosts[0].ref,
      bindHost: "127.0.0.1",
      sourcePort: 1080,
      endpointPort: 0,
      maxRetries: 0,
      retryInterval: 5000,
    },
  ];
  await expect(
    f.repo.apply("owner", { ...f.request, restoreLocalTunnels: true }),
  ).rejects.toThrow("BACKUP_PENDING_LOCAL_LIMIT");
  expect(await adapter.query(sql.raw("SELECT id FROM ssh_data"))).toHaveLength(
    0,
  );
});

it.each([false, true])(
  "returns desktop layout only with explicit preference consent (%s)",
  async (restorePreferences) => {
    const f = await fixture();
    f.request.payload.desktopLayout = {
      dashboardMainWidthPct: 55,
      dashboardView: "homepage",
    };
    const request = { ...f.request, restorePreferences };
    const result = await f.repo.apply("owner", request);
    expect(result.desktopConfiguration?.layout).toEqual(
      restorePreferences ? f.request.payload.desktopLayout : undefined,
    );
    expect(await f.repo.apply("owner", request)).toEqual(result);
  },
);
