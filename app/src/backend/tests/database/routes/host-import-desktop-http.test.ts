import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "../repositories/test-support.js";
import { HostRepository } from "../../../database/repositories/host-repository.js";
import { HostResolutionRepository } from "../../../database/repositories/host-resolution-repository.js";
import { CredentialRepository } from "../../../database/repositories/credential-repository.js";
import { DataCrypto } from "../../../utils/data-crypto.js";
const factories = vi.hoisted(() => ({
  host: vi.fn(),
  resolution: vi.fn(),
  credential: vi.fn(),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: factories.host,
  createCurrentHostResolutionRepository: factories.resolution,
  createCurrentCredentialRepository: factories.credential,
}));
vi.mock("../../../runtime/policy.js", () => ({
  runtimePolicy: { desktop: true },
}));
import { registerHostBulkRoutes } from "../../../database/routes/host-bulk-routes.js";
let db: TestSqliteDatabase, repo: HostRepository, server: Server, url: string;
beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  const context = await db.connect();
  await db.exec(
    "INSERT INTO users (id,username,password_hash) VALUES ('owner','alice','hash'),('other','bob','hash')",
  );
  vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
    Buffer.alloc(32, 7),
  );
  vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(Buffer.alloc(32, 7));
  repo = new HostRepository(context);
  factories.host.mockReturnValue(repo);
  factories.resolution.mockReturnValue(new HostResolutionRepository(context));
  factories.credential.mockReturnValue(new CredentialRepository(context));
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerHostBulkRoutes(router, (req, _res, next) => {
    Object.assign(req, { userId: "owner" });
    next();
  });
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await db?.close();
  vi.restoreAllMocks();
});
it.each([
  ["/bulk-import", false],
  ["/bulk-import", true],
  ["/ssh-config-import", false],
  ["/ssh-config-import", true],
] as const)(
  "%s persists inactive configuration with overwrite=%s",
  async (route, overwrite) => {
    let originalId: number | undefined;
    if (overwrite) {
      const existing = await repo.createEncryptedForUser("owner", {
        userId: "owner",
        name: "existing",
        ip: "127.0.0.1",
        port: 2222,
        username: "fixture",
        authType: "none",
        enableTunnel: true,
        autostartPassword: "fixture-old",
        autostartKey: "fixture-key",
        autostartKeyPassword: "fixture-passphrase",
      });
      originalId = existing.id;
    }
    const body =
      route === "/bulk-import"
        ? {
            overwrite,
            hosts: [
              {
                name: "imported",
                ip: "127.0.0.1",
                port: 2222,
                username: "fixture",
                authType: "none",
                enableTunnel: true,
                enableDocker: true,
                enableProxmox: true,
                enableTmuxMonitor: true,
                statsConfig: {
                  metricsEnabled: true,
                  statusCheckEnabled: true,
                  disableTcpPing: false,
                },
                tunnelConnections: [
                  {
                    id: "t",
                    autoStart: true,
                    sourcePort: 4321,
                    endpointPort: 22,
                  },
                ],
              },
            ],
          }
        : {
            overwrite,
            content:
              "Host imported\n HostName 127.0.0.1\n Port 2222\n User fixture\n",
          };
    const response = await fetch(url + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      success: overwrite ? 0 : 1,
      updated: overwrite ? 1 : 0,
      failed: 0,
    });
    const rows = await db.query<{
      id: number;
      stats_config: string;
      tunnel_connections: string;
      enable_tunnel: number;
      enable_docker: number;
      enable_proxmox: number;
      enable_tmux_monitor: number;
      autostart_password: string | null;
      autostart_key: string | null;
      autostart_key_password: string | null;
    }>(
      sql`SELECT id,stats_config,tunnel_connections,enable_tunnel,enable_docker,enable_proxmox,enable_tmux_monitor,autostart_password,autostart_key,autostart_key_password FROM ssh_data WHERE user_id='owner'`,
    );
    expect(rows).toHaveLength(1);
    if (overwrite) expect(rows[0].id).toBe(originalId);
    expect(rows[0]).toMatchObject({
      enable_tunnel: 0,
      enable_docker: 0,
      enable_proxmox: 0,
      enable_tmux_monitor: 0,
      autostart_password: null,
      autostart_key: null,
      autostart_key_password: null,
    });
    expect(JSON.parse(rows[0].stats_config)).toMatchObject({
      metricsEnabled: false,
      statusCheckEnabled: false,
      disableTcpPing: true,
    });
    if (route === "/bulk-import")
      expect(JSON.parse(rows[0].tunnel_connections)).toEqual([
        { id: "t", autoStart: false, sourcePort: 4321, endpointPort: 22 },
      ]);
    expect(await repo.listByUserId("other")).toEqual([]);
  },
);
it.each(["/bulk-import", "/ssh-config-import"])(
  "%s refuses overwrite when the existing-host lookup fails",
  async (route) => {
    await repo.createEncryptedForUser("owner", {
      userId: "owner",
      name: "keep",
      ip: "127.0.0.1",
      port: 2222,
      username: "fixture",
      authType: "none",
    });
    const before = await repo.listByUserId("owner");
    factories.resolution.mockReturnValue({
      findHostsByUserId: vi
        .fn()
        .mockRejectedValue(Error("private database detail")),
    });
    const body =
      route === "/bulk-import"
        ? {
            overwrite: true,
            credentials: [
              {
                alias: "unused",
                name: "must-not-create",
                authType: "password",
              },
            ],
            hosts: [
              {
                name: "replacement",
                ip: "127.0.0.1",
                port: 2222,
                username: "fixture",
                authType: "none",
              },
            ],
          }
        : {
            overwrite: true,
            content:
              "Host replacement\n HostName 127.0.0.1\n Port 2222\n User fixture\n",
          };
    const response = await fetch(url + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "HOST_IMPORT_LOOKUP_FAILED",
      error: "Cannot read existing hosts. Import was not started.",
    });
    expect(await repo.listByUserId("owner")).toEqual(before);
    expect(await factories.credential().listDecryptedByUserId("owner")).toEqual(
      [],
    );
  },
);

it("imports a credential-free SSH export as unconfigured without binding existing credentials", async () => {
  const response = await fetch(url + "/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hosts: [
        {
          name: "待配置主机",
          ip: "127.0.0.1",
          port: 2222,
          username: "fixture",
          authType: "unconfigured",
          password: "must-not-import",
          key: "must-not-import-key",
          credentialId: 123,
          notes: "中文备注",
        },
      ],
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: 1, failed: 0 });
  const rows = await repo.listDecryptedByUserId("owner");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    authType: "unconfigured",
    password: null,
    key: null,
    credentialId: null,
    notes: "中文备注",
    enableTunnel: false,
  });
  expect(JSON.parse(rows[0].statsConfig!)).toMatchObject({
    metricsEnabled: false,
    statusCheckEnabled: false,
  });
});

it.each([false, true])("refuses missing credential references without selecting another secret, overwrite=%s", async overwrite => {
  const credentials = factories.credential() as CredentialRepository;
  const credential = await credentials.createEncryptedForUser("owner", {
    userId: "owner", name: "unrelated-account", authType: "password",
    username: "private-user", password: "fixture-secret-never-selected",
  });
  if (overwrite) await repo.createEncryptedForUser("owner", {
    userId: "owner", name: "keep-original", ip: "127.0.0.1", port: 2222,
    username: "fixture", authType: "none", notes: "保留备注",
  });
  const before = await repo.listDecryptedByUserId("owner");
  const response = await fetch(url + "/bulk-import", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overwrite, hosts: [{ name: "imported", ip: "127.0.0.1",
      port: 2222, username: "fixture", authType: "credential", credentialId: 999999,
      password: "also-not-authorized-as-fallback" }] }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ success: 0, updated: 0, failed: 1 });
  expect(result.errors.join(" ")).toContain("HOST_IMPORT_CREDENTIAL_NOT_FOUND");
  expect(await repo.listDecryptedByUserId("owner")).toEqual(before);
  expect(await credentials.findByIdForUser("owner", credential.id as number)).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain("fixture-secret-never-selected");
});

it.each([
  ["owner", false], ["owner", true], ["other", false], ["other", true],
] as const)("imports only explicitly accessible credentials, credential owner=%s overwrite=%s", async (credentialOwner, overwrite) => {
  const credentials = factories.credential() as CredentialRepository;
  const unrelated = await credentials.createEncryptedForUser("owner", {
    userId: "owner", name: "first-unselected", authType: "password", password: "first-secret",
  });
  const selected = await credentials.createEncryptedForUser(credentialOwner, {
    userId: credentialOwner, name: "selected-account", authType: "password", password: "selected-secret",
  });
  if (overwrite) await repo.createEncryptedForUser("owner", {
    userId: "owner", name: "existing", ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none",
  });
  const before = await repo.listDecryptedByUserId("owner");
  const response = await fetch(url + "/bulk-import", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overwrite, hosts: [{ name: "imported", ip: "127.0.0.1", port: 2222,
      username: "fixture", authType: "credential", credentialId: selected.id }] }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  const after = await repo.listDecryptedByUserId("owner");
  if (credentialOwner === "other") {
    expect(result).toMatchObject({ success: 0, updated: 0, failed: 1 });
    expect(result.errors.join(" ")).toContain("HOST_IMPORT_CREDENTIAL_NOT_FOUND");
    expect(after).toEqual(before);
  } else {
    expect(result).toMatchObject({ success: overwrite ? 0 : 1, updated: overwrite ? 1 : 0, failed: 0 });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ authType: "credential", credentialId: selected.id,
      password: null, key: null, enableTunnel: false });
    expect(after[0].credentialId).not.toBe(unrelated.id);
    if (overwrite) expect(after[0].id).toBe(before[0].id);
  }
  expect(await repo.listByUserId("other")).toEqual([]);
  expect(await credentials.findByIdForUser(credentialOwner, selected.id as number)).toBeTruthy();
  expect(JSON.stringify(result)).not.toMatch(/first-secret|selected-secret/);
});

it.each([false, true])("rejects ambiguous credential names, imported alias=%s", async importedAlias => {
  const credentials = factories.credential() as CredentialRepository;
  for (const name of ["Deploy", "deploy"]) await credentials.createEncryptedForUser("owner", {
    userId: "owner", name, authType: "password", password: "fixture-" + name,
  });
  const response = await fetch(url + "/bulk-import", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(importedAlias ? { credentials: [{ alias: "remote-alias", name: "DEPLOY", authType: "password" }] } : {}),
      hosts: [{ ip: "127.0.0.1", port: 2222, username: "fixture", authType: "credential",
        credentialAlias: importedAlias ? "remote-alias" : "DEPLOY" }],
    }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ success: 0, updated: 0, failed: 1 });
  expect(result.errors.join(" ")).toContain("HOST_IMPORT_CREDENTIAL_AMBIGUOUS");
  expect(await repo.listByUserId("owner")).toEqual([]);
  expect(await credentials.listByUserId("owner")).toHaveLength(2);
});

it.each(["/bulk-import", "/ssh-config-import"])("%s refuses ambiguous overwrite targets", async route => {
  for (const name of ["keep-first", "keep-second"]) await repo.createEncryptedForUser("owner", {
    userId: "owner", name, ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none", notes: name,
  });
  const before = await repo.listDecryptedByUserId("owner");
  const response = await fetch(url + route, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(route === "/bulk-import" ? { overwrite: true, hosts: [{ name: "replacement",
      ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none" }] }
      : { overwrite: true, content: "Host replacement\n HostName 127.0.0.1\n Port 2222\n User fixture\n" }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ success: 0, updated: 0, failed: 1 });
  expect(result.errors.join(" ")).toContain("HOST_IMPORT_TARGET_AMBIGUOUS");
  expect(await repo.listDecryptedByUserId("owner")).toEqual(before);
});

it.each([
  ["/bulk-import", false], ["/bulk-import", true],
  ["/ssh-config-import", false], ["/ssh-config-import", true],
] as const)("%s skips duplicates without overwrite, preexisting=%s", async (route, preexisting) => {
  if (preexisting) await repo.createEncryptedForUser("owner", { userId: "owner", name: "keep-original",
    ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none", notes: "保留" });
  const before = await repo.listDecryptedByUserId("owner");
  const host = { name: "first-import", ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none" };
  const response = await fetch(url + route, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(route === "/bulk-import" ? { overwrite: false, hosts: [host, { ...host, name: "second-import" }] }
      : { overwrite: false, content: "Host first-import\n HostName 127.0.0.1\n Port 2222\n User fixture\nHost second-import\n HostName 127.0.0.1\n Port 2222\n User fixture\n" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: preexisting ? 0 : 1, updated: 0, skipped: preexisting ? 2 : 1, failed: 0 });
  const after = await repo.listDecryptedByUserId("owner");
  expect(after).toHaveLength(1);
  if (preexisting) expect(after).toEqual(before);
  else expect(after[0].name).toBe("first-import");
});

it("does not import policy or execution claims through legacy JSON host import", async () => {
  const policy = JSON.stringify({ revision: 7, sets: [{ id: "strict", strictAllowlist: true,
    scope: { type: "global" }, rules: [{ id: "deny", effect: "deny", match: { kind: "program", program: "rm" } }] }] });
  await db.run(sql`INSERT INTO settings (key,value) VALUES ('tandem-policy:owner',${policy})`);
  const response = await fetch(url + "/bulk-import", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policy: { sets: [] }, rules: [], runAfterImport: "must-not-run",
      hosts: [{ name: "host", ip: "127.0.0.1", port: 2222, username: "fixture", authType: "none",
        policy: { sets: [] }, allowedHostIds: [999], autoConnect: true, runAfterImport: "must-not-run",
        enableTunnel: true, tunnelConnections: [{ id: "import", autoStart: true }] }] }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: 1, failed: 0 });
  const rows = await db.query<{ value: string }>(sql`SELECT value FROM settings WHERE key='tandem-policy:owner'`);
  expect(rows).toEqual([{ value: policy }]);
  const hosts = await repo.listDecryptedByUserId("owner");
  expect(hosts).toHaveLength(1);
  expect(hosts[0].enableTunnel).toBe(false);
  expect(JSON.stringify(hosts)).not.toMatch(/must-not-run|allowedHostIds|autoConnect/);
  expect(JSON.parse(hosts[0].tunnelConnections!)[0].autoStart).toBe(false);
});
