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
