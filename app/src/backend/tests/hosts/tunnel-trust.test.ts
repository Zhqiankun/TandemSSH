import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createServer, connect as connectTcp } from "node:net";
import type { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { Server } from "ssh2";
import type { TunnelConfig } from "../../../types/index.js";
import type { HostTrustRecord } from "../../../types/host-trust.js";
import { HostTrustService } from "../../hosts/trust/service";
const current = vi.hoisted(() => ({
  trust: undefined as HostTrustService | undefined,
  credentialLookup: vi.fn(),
}));
vi.mock("../../hosts/trust/production.js", () => ({
  hostTrust: {
    verify: (...args: Parameters<HostTrustService["verify"]>) =>
      current.trust!.verify(...args),
    report: (...args: Parameters<HostTrustService["report"]>) =>
      current.trust!.report(...args),
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findCredentialByIdForUser: current.credentialLookup,
    findHostKeyVerificationData: async () => ({
      name: "隧道测试",
      hostKeyFingerprint: null,
    }),
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn() },
  tunnelLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ canAccessHost: async () => ({ hasAccess: true }) }),
  },
}));
vi.mock("../../utils/audit-logger.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({}) },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => null },
}));
vi.mock("../../hosts/metrics/automation-bridge.js", () => ({
  notifyAutomationInternalEvent: vi.fn(),
}));
import {
  connectSSHTunnel,
  cleanupTunnelResources,
  tunnelConfigs,
  connectionStatus,
  manualDisconnects,
  activeRetryTimers,
} from "../../hosts/tunnel/manager";
import {
  connectClient,
  forwardOut,
  pipeTunnelStreams,
} from "../../hosts/tunnel/ssh-primitives";
import { tunnelTrustTarget } from "../../hosts/tunnel/connection-trust";
import { classifyTunnelError } from "../../hosts/tunnel/utils";
import { DataCrypto } from "../../utils/data-crypto";
import { acceptedHostKeyFor } from "../../hosts/accepted-host-key";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  current.trust?.dispose();
});
function trust() {
  const rows = new Map<string, HostTrustRecord>();
  current.trust = new HostTrustService({
    store: {
      get: async (id, user) => {
        const r = rows.get(id);
        return r?.userId === user ? r : undefined;
      },
      compareAndSet: async (row, revision) => {
        if ((rows.get(row.id)?.revision ?? 0) !== revision)
          throw Error("HOST_TRUST_RECORD_CHANGED");
        rows.set(row.id, row);
      },
    },
    audit: async () => {},
  });
  return current.trust;
}
async function ssh(port = 0) {
  const sockets = new Set<Socket>();
  const echo = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const echoPort = (echo.address() as { port: number }).port;
  const clients = new Set<{ end(): void }>();
  let auth = 0,
    forwards = 0;
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs1", format: "pem" });
  const server = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.once("close", () => clients.delete(client));
    client.on("authentication", (ctx) => {
      auth++;
      if (ctx.method === "password" && ctx.password === "fixture-only")
        ctx.accept();
      else ctx.reject();
    });
    client.on("tcpip", (accept, reject, info) => {
      forwards++;
      if (info.destIP !== "127.0.0.1" || info.destPort !== echoPort) {
        reject();
        return;
      }
      const socket = connectTcp(echoPort, "127.0.0.1");
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("error", () => reject());
      socket.once("connect", () => {
        const channel = accept();
        channel.on("error", () => socket.destroy());
        channel.once("close", () => socket.destroy());
        socket.pipe(channel).pipe(socket);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const c of clients) c.end();
    for (const s of sockets) s.destroy();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => echo.close(() => resolve())),
    ]);
  };
  cleanup.push(stop);
  return {
    port: (server.address() as { port: number }).port,
    echoPort,
    auth: () => auth,
    forwards: () => forwards,
    stop,
  };
}
function config(port: number): TunnelConfig {
  return {
    name: "trusted-tunnel",
    sourceHostId: 7,
    tunnelIndex: 0,
    requestingUserId: "requester",
    sourceUserId: "credential-owner",
    endpointUserId: "endpoint-owner",
    hostName: "source",
    sourceIP: "127.0.0.1",
    sourceSSHPort: port,
    sourceUsername: "fixture",
    sourceAuthMethod: "password",
    endpointIP: "127.0.0.1",
    endpointSSHPort: port,
    endpointUsername: "fixture",
    endpointHost: "endpoint",
    endpointAuthMethod: "password",
    sourcePort: 1234,
    endpointPort: 5678,
    maxRetries: 3,
    retryInterval: 100,
    autoStart: false,
    isPinned: false,
  };
}
function open(port: number, role: "source" | "endpoint") {
  const pending = connectClient(
    {
      host: "127.0.0.1",
      port,
      username: "fixture",
      password: "fixture-only",
      readyTimeout: 6000,
    },
    "trusted-tunnel",
    role,
    config(port),
  );
  void pending.catch(() => {});
  pending.then(
    (c) => cleanup.push(() => c.end()),
    () => {},
  );
  return pending;
}
async function decide(
  service: HostTrustService,
  action: "trust" | "reject" = "trust",
) {
  await vi.waitFor(() =>
    expect(service.list("requester").requests).toHaveLength(1),
  );
  const request = service.list("requester").requests[0];
  await service.decide("requester", {
    requestId: request.id,
    fingerprint: request.fingerprint,
    expectedRevision: request.expectedRevision,
    action,
    verified: true,
  });
  return request;
}
describe("tunnel SSH identity and forwarding", () => {
  it.each(["source", "endpoint"] as const)(
    "requires the requesting user's trust before %s authentication and forwarding",
    async (role) => {
      const service = trust(),
        server = await ssh(),
        pending = open(server.port, role);
      await vi.waitFor(() =>
        expect(service.list("requester").requests).toHaveLength(1),
      );
      expect(server.auth()).toBe(0);
      expect(server.forwards()).toBe(0);
      expect(service.list("credential-owner").requests).toEqual([]);
      expect(service.list("endpoint-owner").requests).toEqual([]);
      const request = await decide(service),
        client = await pending;
      expect(acceptedHostKeyFor(client)).toBe(request.fingerprint);
      const channel = await forwardOut(client, "127.0.0.1", server.echoPort),
        payload = Buffer.from([0, 255, 12, 1, 10, 32, 130]);
      const received = new Promise<Buffer>((resolve, reject) => {
        let data = Buffer.alloc(0);
        channel.on("error", reject);
        channel.on("data", (b) => {
          data = Buffer.concat([data, b]);
          if (data.length >= payload.length) resolve(data);
        });
      });
      channel.write(payload);
      expect((await received).equals(payload)).toBe(true);
      channel.end();
      expect(server.forwards()).toBe(1);
      client.end();
      const again = await open(server.port, role);
      expect(service.list("requester").requests).toEqual([]);
      again.end();
    },
    15000,
  );
  it.each(["source", "endpoint"] as const)(
    "refuses a changed %s key before sending credentials",
    async (role) => {
      const service = trust(),
        first = await ssh(),
        pending = open(first.port, role);
      await decide(service);
      (await pending).end();
      await first.stop();
      const changed = await ssh(first.port),
        connection = open(changed.port, role);
      await vi.waitFor(() =>
        expect(service.list("requester").requests[0]?.scenario).toBe("changed"),
      );
      expect(changed.auth()).toBe(0);
      await decide(service, "reject");
      await expect(connection).rejects.toThrow();
      expect(changed.auth()).toBe(0);
      expect(classifyTunnelError("Host denied (verification failed)")).toBe(
        "CONNECTION_FAILED",
      );
    },
    15000,
  );
  it("does not accept a credential owner as the requester or connect without an identity", async () => {
    const c = config(22);
    expect(tunnelTrustTarget(c, "source")).toMatchObject({
      userId: "requester",
      hostId: 7,
    });
    expect(tunnelTrustTarget(c, "endpoint")).toMatchObject({
      userId: "requester",
      hostId: null,
    });
    const socket = new PassThrough();
    await expect(
      connectClient({ sock: socket }, c.name, "endpoint", {
        ...c,
        requestingUserId: undefined,
        sourceUserId: undefined,
      }),
    ).rejects.toThrow("TUNNEL_TRUST_IDENTITY_REQUIRED");
    expect(socket.destroyed).toBe(true);
  });
});
it("closes an outbound tunnel stream that arrives after its inbound socket closes", async () => {
  const inbound = new PassThrough(),
    outbound = new PassThrough();
  let resolve!: (s: PassThrough) => void;
  const pending = new Promise<PassThrough>((r) => {
    resolve = r;
  });
  pipeTunnelStreams(inbound, pending, "late");
  inbound.destroy();
  resolve(outbound);
  await vi.waitFor(() => expect(outbound.destroyed).toBe(true));
});
it("handles inbound errors while forwarding is still pending", async () => {
  const inbound = new PassThrough(),
    outbound = new PassThrough();
  let resolve!: (s: PassThrough) => void;
  pipeTunnelStreams(
    inbound,
    new Promise<PassThrough>((r) => {
      resolve = r;
    }),
    "early-error",
  );
  expect(() => inbound.emit("error", Error("closed"))).not.toThrow();
  resolve(outbound);
  await vi.waitFor(() =>
    expect(outbound.destroyed && inbound.destroyed).toBe(true),
  );
});

it("uses trust in the actual tunnel manager and frees its local listener on stop", async () => {
  const service = trust(),
    server = await ssh(),
    reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const c = {
    ...config(server.port),
    name: "managed-" + port,
    scope: "s2s" as const,
    mode: "local" as const,
    sourcePort: port,
    endpointPort: server.echoPort,
    sourcePassword: "fixture-only",
    endpointHost: "127.0.0.1",
    targetHost: "127.0.0.1",
  };
  tunnelConfigs.set(c.name, c);
  cleanup.push(async () => {
    manualDisconnects.add(c.name);
    await cleanupTunnelResources(c.name, true);
    tunnelConfigs.delete(c.name);
    connectionStatus.delete(c.name);
  });
  await connectSSHTunnel(c);
  await vi.waitFor(() =>
    expect(service.list("requester").requests).toHaveLength(1),
  );
  expect(server.auth()).toBe(0);
  const blocked = connectTcp(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    blocked.once("error", () => resolve());
    blocked.once("connect", () => {
      blocked.destroy();
      reject(Error("Listener opened before trust"));
    });
  });
  await decide(service);
  await vi.waitFor(() =>
    expect(connectionStatus.get(c.name)?.connected).toBe(true),
  );
  const socket = connectTcp(port, "127.0.0.1"),
    payload = Buffer.from("actual managed tunnel");
  const received = new Promise<Buffer>((resolve, reject) => {
    let value = Buffer.alloc(0);
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      value = Buffer.concat([value, chunk]);
      if (value.length === payload.length) resolve(value);
    });
  });
  socket.once("connect", () => socket.write(payload));
  expect((await received).equals(payload)).toBe(true);
  manualDisconnects.add(c.name);
  await cleanupTunnelResources(c.name, true);
  await vi.waitFor(() => expect(socket.destroyed).toBe(true));
  expect(activeRetryTimers.has(c.name)).toBe(false);
  const reuse = createServer();
  await new Promise<void>((resolve, reject) => {
    reuse.once("error", reject);
    reuse.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => reuse.close(() => resolve()));
}, 15000);

it("does not retry a rejected manager handshake or start a cleanup SSH connection", async () => {
  const service = trust(),
    server = await ssh();
  const c = {
    ...config(server.port),
    name: "rejected-managed-" + server.port,
    scope: "s2s" as const,
    mode: "local" as const,
    sourcePassword: "fixture-only",
    endpointHost: "127.0.0.1",
    targetHost: "127.0.0.1",
    endpointPort: server.echoPort,
  };
  tunnelConfigs.set(c.name, c);
  cleanup.push(async () => {
    manualDisconnects.add(c.name);
    await cleanupTunnelResources(c.name, true);
    tunnelConfigs.delete(c.name);
    connectionStatus.delete(c.name);
  });
  await connectSSHTunnel(c);
  await decide(service, "reject");
  await vi.waitFor(() =>
    expect(connectionStatus.get(c.name)?.errorType).toBe("CONNECTION_FAILED"),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(server.auth()).toBe(0);
  expect(service.list("requester").requests).toEqual([]);
  expect(activeRetryTimers.has(c.name)).toBe(false);
}, 10000);

it("looks up endpoint credentials for the authenticated requester, not a supplied owner", async () => {
  const key = vi
    .spyOn(DataCrypto, "getUserDataKey")
    .mockReturnValue(Buffer.alloc(32));
  current.credentialLookup.mockReset();
  current.credentialLookup.mockResolvedValue(null);
  const c = {
    ...config(22),
    name: "credential-owner-check",
    scope: "s2s" as const,
    mode: "remote" as const,
    sourcePassword: "fixture-only",
    endpointIP: "127.0.0.2",
    endpointCredentialId: 9,
  };
  try {
    await connectSSHTunnel(c);
    expect(current.credentialLookup).toHaveBeenCalledWith(9, "requester");
    expect(current.credentialLookup).toHaveBeenCalledTimes(1);
    expect(connectionStatus.get(c.name)?.connected).toBe(false);
  } finally {
    key.mockRestore();
    connectionStatus.delete(c.name);
  }
});
