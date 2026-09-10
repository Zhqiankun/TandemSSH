import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createServer, connect as connectTcp } from "node:net";
import type { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { Server, Client } from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import express from "express";
import type { RequestHandler } from "express";
import { registerTunnelRoutes } from "../../hosts/tunnel/routes";
import {
  handleC2SRelayOpen,
  handleC2SRelayTest,
} from "../../hosts/tunnel/c2s-relay";
import { CONNECTION_STATES, type TunnelConfig } from "../../../types/index.js";
import type { HostTrustRecord } from "../../../types/host-trust.js";
import { HostTrustService } from "../../hosts/trust/service";
const current = vi.hoisted(() => ({
  trust: undefined as HostTrustService | undefined,
  credentialLookup: vi.fn(),
  resolvedHost: {} as Record<string, unknown>,
  dns: vi.fn(async () => {}),
  hostLookup: vi.fn(),
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
vi.mock("../../hosts/ssh-dns.js", () => ({
  resolveSshConnectConfigHost: () => current.dns(),
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: async () => current.resolvedHost,
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn() },
  fileLogger: { error: vi.fn() },
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
    getInstance: () => ({
      canAccessHost: async (user: string) => ({
        hasAccess: user === "requester",
      }),
    }),
  },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(),
  getAuditUsername: async () => "fixture",
  getRequestMeta: () => ({}),
}));
vi.mock("axios", async (importOriginal) => {
  const original = await importOriginal<typeof import("axios")>();
  return {
    ...original,
    default: {
      ...original.default,
      get: (...args: unknown[]) => current.hostLookup(...args),
    },
  };
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () =>
        ((req, _res, next) => {
          Object.assign(req, {
            userId: req.headers["x-fixture-user"] || "requester",
          });
          next();
        }) satisfies RequestHandler,
    }),
  },
}));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({ getInternalAuthToken: async () => "fixture-only" }),
  },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => null },
}));
vi.mock("../../hosts/metrics/automation-bridge.js", () => ({
  notifyAutomationInternalEvent: vi.fn(),
}));
import {
  establishDirectTunnel,
  establishManagedS2STunnel,
  activeTunnelRuntimes,
  connectSSHTunnel,
  cleanupTunnelResources,
  tunnelConfigs,
  connectionStatus,
  manualDisconnects,
  activeRetryTimers,
  pendingTunnelOperations,
  activeTunnels,
  tunnelConnecting,
  broadcastTunnelStatus,
} from "../../hosts/tunnel/manager";
import {
  connectClient,
  bindForwardIn,
  forwardOut,
  pipeTunnelStreams,
} from "../../hosts/tunnel/ssh-primitives";
import { tunnelTrustTarget } from "../../hosts/tunnel/connection-trust";
import { classifyTunnelError } from "../../hosts/tunnel/utils";
import { createJumpHostChain } from "../../hosts/jump-host-chain";
import * as terminalAuth from "../../hosts/terminal-auth-helpers";
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
async function ssh(port = 0, allowedPort?: number) {
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
      if (
        info.destIP !== "127.0.0.1" ||
        info.destPort !== (allowedPort ?? echoPort)
      ) {
        reject();
        return;
      }
      const socket = connectTcp(allowedPort ?? echoPort, "127.0.0.1");
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
    clients: () => clients.size,
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

function trackedManager(c: TunnelConfig) {
  tunnelConfigs.set(c.name, c);
  cleanup.push(async () => {
    manualDisconnects.add(c.name);
    await cleanupTunnelResources(c.name, true);
    tunnelConfigs.delete(c.name);
    connectionStatus.delete(c.name);
    manualDisconnects.delete(c.name);
    tunnelConnecting.delete(c.name);
  });
}

it.each(["source", "endpoint"] as const)(
  "cancels the real manager during %s trust with no late authentication or retry",
  async (role) => {
    const service = trust(),
      endpoint = await ssh(),
      source = await ssh(0, endpoint.port);
    const c: TunnelConfig = {
      ...config(source.port),
      name: "cancel-" + role + source.port,
      scope: "s2s",
      mode: "local",
      sourcePort: 0,
      sourcePassword: "fixture-only",
      endpointSSHPort: role === "endpoint" ? endpoint.port : source.port,
      endpointPassword: "fixture-only",
      targetHost: "127.0.0.1",
    };
    trackedManager(c);
    await connectSSHTunnel(c);
    if (role === "endpoint") await decide(service);
    await vi.waitFor(() =>
      expect(service.list("requester").requests).toHaveLength(1),
    );
    const pending = service.list("requester").requests[0];
    expect(role === "endpoint" ? endpoint.auth() : source.auth()).toBe(0);
    // Exercise the same forced cleanup as the cancel route, even without a manual flag.
    await cleanupTunnelResources(c.name, true);
    broadcastTunnelStatus(c.name, {
      connected: false,
      status: CONNECTION_STATES.DISCONNECTED,
      manualDisconnect: true,
    });
    await vi.waitFor(() =>
      expect(service.list("requester").requests).toEqual([]),
    );
    await expect(
      service.decide("requester", {
        requestId: pending.id,
        fingerprint: pending.fingerprint,
        expectedRevision: pending.expectedRevision,
        action: "trust",
        verified: true,
      }),
    ).rejects.toThrow("HOST_TRUST_REQUEST_NOT_FOUND");
    await vi.waitFor(() =>
      expect(source.clients() + endpoint.clients()).toBe(0),
    );
    expect(role === "endpoint" ? endpoint.auth() : source.auth()).toBe(0);
    expect(activeTunnels.has(c.name)).toBe(false);
    expect(activeRetryTimers.has(c.name)).toBe(false);
    expect(connectionStatus.get(c.name)?.status).toBe(
      CONNECTION_STATES.DISCONNECTED,
    );
    // A new explicit connect must work; the cancelled attempt must not clear its state.
    if (role === "source") {
      await connectSSHTunnel(c);
      await decide(service);
      await vi.waitFor(() =>
        expect(connectionStatus.get(c.name)?.connected).toBe(true),
      );
    }
  },
  15000,
);

it("settles an aborted forward and destroys its late channel", async () => {
  const client = new Client(),
    controller = new AbortController(),
    channel = new PassThrough();
  let respond!: (error: Error | undefined, stream: unknown) => void;
  vi.spyOn(client, "forwardOut").mockImplementation((...args) => {
    respond = args[4] as typeof respond;
    return client;
  });
  const pending = forwardOut(
    client,
    "127.0.0.1",
    22,
    undefined,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toThrow("cancel fixture");
  controller.abort(Error("cancel fixture"));
  await rejected;
  respond(undefined, channel);
  expect(channel.destroyed).toBe(true);
  expect(client.listenerCount("close")).toBe(0);
});

it("unbinds a remote listener acknowledged after cancellation", async () => {
  const client = new Client(),
    controller = new AbortController();
  let respond!: (error: Error | undefined, port: number) => void;
  vi.spyOn(client, "forwardIn").mockImplementation((_host, _port, cb) => {
    respond = cb!;
    return client;
  });
  const unbind = vi
    .spyOn(client, "unforwardIn")
    .mockImplementation((_host, _port, cb) => {
      cb?.();
      return client;
    });
  const pending = bindForwardIn(client, "127.0.0.1", 12345, controller.signal);
  const rejected = expect(pending).rejects.toThrow("cancel fixture");
  controller.abort(Error("cancel fixture"));
  await rejected;
  respond(undefined, 12345);
  expect(unbind).toHaveBeenCalledWith("127.0.0.1", 12345, expect.any(Function));
  expect(client.listenerCount("close")).toBe(0);
});

it.each(["local", "remote", "dynamic", "test"] as const)(
  "closes pending %s C2S trust when the real WebSocket closes",
  async (mode) => {
    const service = trust(),
      server = await ssh();
    current.resolvedHost = {
      id: 7,
      ip: "127.0.0.1",
      port: server.port,
      username: "fixture",
      password: "fixture-only",
      authType: "password",
      userId: "credential-owner",
      name: "C2S取消",
    };
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    let relay!: WebSocket;
    const accepted = new Promise<void>((resolve) =>
      wss.once("connection", (ws) => {
        relay = ws;
        resolve();
      }),
    );
    const browser = new WebSocket(
      "ws://127.0.0.1:" + (wss.address() as { port: number }).port,
    );
    cleanup.push(async () => {
      browser.terminate();
      relay?.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await accepted;
    const pending = (mode === "test" ? handleC2SRelayTest : handleC2SRelayOpen)(
      relay,
      {
        type: mode === "test" ? "test" : "open",
        targetHost: "127.0.0.1",
        targetPort: server.echoPort,
        tunnelConfig: {
          sourceHostId: 7,
          mode: mode === "test" ? "local" : mode,
          sourcePort: 12345,
          endpointPort: server.echoPort,
        },
      },
      "requester",
    );
    const rejected = expect(pending).rejects.toThrow(
      "TUNNEL_CONNECTION_CANCELLED",
    );
    await vi.waitFor(() =>
      expect(service.list("requester").requests).toHaveLength(1),
    );
    browser.close();
    await rejected;
    await vi.waitFor(() =>
      expect(service.list("requester").requests).toEqual([]),
    );
    await vi.waitFor(() => expect(server.clients()).toBe(0));
    expect(server.auth()).toBe(0);
    expect(server.forwards()).toBe(0);
  },
  10000,
);

it("cancels a manager connection while its actual SOCKS handshake is pending", async () => {
  const service = trust(),
    sshServer = await ssh();
  const sockets = new Set<Socket>();
  let bytes = 0;
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (b) => {
      bytes += b.length;
    });
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  const c: TunnelConfig = {
    ...config(sshServer.port),
    name: "cancel-proxy-" + sshServer.port,
    sourcePassword: "fixture-only",
    scope: "s2s",
    mode: "local",
    useSocks5: true,
    socks5Host: "127.0.0.1",
    socks5Port: (proxy.address() as { port: number }).port,
  };
  trackedManager(c);
  const pending = connectSSHTunnel(c);
  await vi.waitFor(() => expect(bytes).toBeGreaterThan(0));
  await cleanupTunnelResources(c.name, true);
  await pending;
  await vi.waitFor(() => expect(sockets.size).toBe(0));
  expect(sshServer.clients()).toBe(0);
  expect(service.list("requester").requests).toEqual([]);
  expect(activeRetryTimers.has(c.name)).toBe(false);
  expect(tunnelConnecting.has(c.name)).toBe(false);
}, 10000);

it("does not connect when hostname resolution returns after cancellation", async () => {
  const service = trust(),
    server = await ssh();
  let release!: () => void;
  current.dns.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const c: TunnelConfig = {
    ...config(server.port),
    name: "cancel-dns-" + server.port,
    sourcePassword: "fixture-only",
    scope: "s2s",
    mode: "local",
  };
  trackedManager(c);
  const pending = connectSSHTunnel(c);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await cleanupTunnelResources(c.name, true);
  release();
  await pending;
  expect(server.clients()).toBe(0);
  expect(service.list("requester").requests).toEqual([]);
  expect(tunnelConnecting.has(c.name)).toBe(false);
});

it.each(["cancel", "disconnect"] as const)(
  "%s cancels endpoint lookup and queued requests through the real HTTP route",
  async (action) => {
    trust();
    const sshServer = await ssh();
    const c: TunnelConfig = {
      ...config(sshServer.port),
      name: "7::0::source::1234::endpoint::5678",
      sourcePassword: "fixture-only",
      endpointIP: "",
      endpointUsername: "",
      endpointSSHPort: 2222,
      scope: "s2s",
      mode: "local",
    };
    let release!: () => void;
    current.hostLookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: [] });
        }),
    );
    const app = express();
    app.use(express.json());
    registerTunnelRoutes(app);
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", resolve));
    const base =
      "http://127.0.0.1:" + (http.address() as { port: number }).port;
    const post = (path: string, body: unknown, user = "requester") =>
      fetch(base + "/ssh/tunnel/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-fixture-user": user },
        body: JSON.stringify(body),
      });
    cleanup.push(async () => {
      release?.();
      await pendingTunnelOperations.get(c.name);
      manualDisconnects.add(c.name);
      await cleanupTunnelResources(c.name, true);
      tunnelConfigs.delete(c.name);
      connectionStatus.delete(c.name);
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    expect((await post("connect", c)).status).toBe(200);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(
      (await post(action, { tunnelName: c.name }, "unrelated-user")).status,
    ).toBe(403);
    expect((await post("connect", c)).status).toBe(200);
    expect((await post(action, { tunnelName: c.name })).status).toBe(200);
    const operation = pendingTunnelOperations.get(c.name);
    // Cancellation must settle queued requests before the unabortable fixture lookup returns.
    await operation;
    await vi.waitFor(() =>
      expect(pendingTunnelOperations.has(c.name)).toBe(false),
    );
    expect(sshServer.clients()).toBe(0);
    expect(sshServer.auth()).toBe(0);
    expect(tunnelConfigs.has(c.name)).toBe(false);
    expect(connectionStatus.get(c.name)?.status).toBe(
      CONNECTION_STATES.DISCONNECTED,
    );
    const next = {
      ...c,
      endpointIP: "127.0.0.1",
      endpointSSHPort: sshServer.port,
      endpointUsername: "fixture",
    };
    expect((await post("connect", next)).status).toBe(200);
    await vi.waitFor(() =>
      expect(current.trust!.list("requester").requests).toHaveLength(1),
    );
    // The old unresolved lookup must not block a new explicit connection or overwrite it later.
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(tunnelConfigs.get(c.name)?.endpointIP).toBe("127.0.0.1");
    expect((await post(action, { tunnelName: c.name })).status).toBe(200);
    await vi.waitFor(() => expect(sshServer.clients()).toBe(0));
    expect(sshServer.auth()).toBe(0);
  },
  10000,
);

it("cancels a real jump-host trust handshake before authentication and can connect again", async () => {
  const service = trust(),
    server = await ssh(),
    controller = new AbortController();
  current.resolvedHost = {
    id: 7,
    ip: "127.0.0.1",
    port: server.port,
    username: "fixture",
    password: "fixture-only",
    authType: "password",
  };
  const connecting = createJumpHostChain(
    [{ hostId: 7 }],
    "requester",
    controller.signal,
  );
  const rejected = expect(connecting).rejects.toThrow("cancel jump fixture");
  await vi.waitFor(() =>
    expect(service.list("requester").requests).toHaveLength(1),
  );
  controller.abort(Error("cancel jump fixture"));
  await rejected;
  await vi.waitFor(() =>
    expect(service.list("requester").requests).toEqual([]),
  );
  await vi.waitFor(() => expect(server.clients()).toBe(0));
  expect(server.auth()).toBe(0);
  const again = createJumpHostChain([{ hostId: 7 }], "requester");
  await decide(service);
  const client = await again;
  expect(client).not.toBeNull();
  cleanup.push(() => client?.end());
  const channel = await forwardOut(client!, "127.0.0.1", server.echoPort);
  const bytes = new Promise<Buffer>((resolve) => channel.once("data", resolve));
  channel.write("jump forwarding");
  expect((await bytes).toString()).toBe("jump forwarding");
  channel.destroy();
}, 15000);

it("settles asynchronous agent setup failures in a jump chain", async () => {
  trust();
  const server = await ssh();
  current.resolvedHost = {
    id: 7,
    ip: "127.0.0.1",
    port: server.port,
    username: "fixture",
    authType: "agent",
  };
  const agent = vi
    .spyOn(terminalAuth, "applyAgentAuth")
    .mockResolvedValue({ error: "fixture agent unavailable" });
  try {
    await expect(
      createJumpHostChain([{ hostId: 7 }], "requester"),
    ).rejects.toThrow("fixture agent unavailable");
    expect(server.clients()).toBe(0);
  } finally {
    agent.mockRestore();
  }
}, 10000);

/** Owns real SSH and TCP listeners; destination allowlists contain fixture ports only. */
async function matrixSsh() {
  const sockets = new Set<Socket>();
  const ownSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  const echo = createServer((socket) => {
    ownSocket(socket);
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const echoPort = (echo.address() as { port: number }).port,
    allowed = new Set([echoPort]),
    bindAllowed = new Set<number>();
  const peers = new Set<import("ssh2").Connection>(),
    listeners = new Set<import("node:net").Server>();
  let forwards = 0,
    binds = 0,
    execs = 0,
    denied = 0;
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs1", format: "pem" });
  const server = new Server({ hostKeys: [key] }, (peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    const bound = new Map<number, import("node:net").Server>();
    peer.once("close", () => {
      peers.delete(peer);
      for (const listener of bound.values()) listener.close();
    });
    peer.on("authentication", (ctx) =>
      ctx.method === "password" && ctx.password === "fixture-only"
        ? ctx.accept()
        : ctx.reject(),
    );
    peer.on("session", (accept) => {
      const session = accept();
      session.on("exec", (_accept, reject) => {
        execs++;
        reject();
      });
    });
    peer.on("tcpip", (accept, reject, info) => {
      if (info.destIP !== "127.0.0.1" || !allowed.has(info.destPort)) {
        denied++;
        reject();
        return;
      }
      forwards++;
      const socket = ownSocket(connectTcp(info.destPort, "127.0.0.1"));
      socket.once("error", reject);
      socket.once("connect", () => {
        const channel = accept();
        channel.on("error", () => socket.destroy());
        channel.once("close", () => socket.destroy());
        socket.pipe(channel).pipe(socket);
      });
    });
    peer.on("request", (accept, reject, name, info) => {
      if (info.bindAddr !== "127.0.0.1" || !bindAllowed.has(info.bindPort)) {
        denied++;
        reject?.();
        return;
      }
      if (name === "cancel-tcpip-forward") {
        const listener = bound.get(info.bindPort);
        bound.delete(info.bindPort);
        listener?.close();
        accept?.();
        return;
      }
      if (bound.has(info.bindPort)) {
        reject?.();
        return;
      }
      const listener = createServer((socket) => {
        ownSocket(socket);
        peer.forwardOut(
          info.bindAddr,
          info.bindPort,
          socket.remoteAddress ?? "127.0.0.1",
          socket.remotePort ?? 0,
          (error, channel) => {
            if (error || socket.destroyed) {
              channel?.destroy();
              socket.destroy();
              return;
            }
            channel.on("error", () => socket.destroy());
            channel.once("close", () => socket.destroy());
            socket.pipe(channel).pipe(socket);
          },
        );
      });
      listeners.add(listener);
      listener.once("close", () => listeners.delete(listener));
      listener.once("error", () => reject?.());
      listener.listen(info.bindPort, "127.0.0.1", () => {
        binds++;
        bound.set(info.bindPort, listener);
        accept?.(info.bindPort);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const peer of peers) peer.end();
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [...listeners].map((l) => new Promise<void>((r) => l.close(() => r()))),
    );
    await Promise.all([
      new Promise<void>((r) => echo.close(() => r())),
      new Promise<void>((r) => server.close(() => r())),
    ]);
  });
  return {
    port: (server.address() as { port: number }).port,
    echoPort,
    allowed,
    bindAllowed,
    stats: () => ({ forwards, binds, execs, denied }),
    clients: () => peers.size,
    disconnectClients: () => {
      for (const peer of peers) peer.end();
    },
  };
}
async function matrixPort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function matrixRead(socket: Socket, bytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    let result = Buffer.alloc(0);
    const timer = setTimeout(() => finish(Error("matrix-read-timeout")), 3000);
    const data = (chunk: Buffer) => {
      result = Buffer.concat([result, chunk]);
      if (result.length >= bytes) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.off("data", data);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(result);
    };
    socket.on("data", data);
    socket.once("error", finish);
  });
}
it.each([
  ["single-host", "local"],
  ["single-host", "remote"],
  ["single-host", "dynamic"],
  ["two-host", "local"],
  ["two-host", "remote"],
  ["two-host", "dynamic"],
] as const)(
  "transfers real binary data and releases the %s %s tunnel",
  async (scope, mode) => {
    const service = trust(),
      endpoint = await matrixSsh(),
      source = await matrixSsh(),
      port = await matrixPort();
    source.allowed.add(endpoint.port);
    source.bindAllowed.add(port);
    endpoint.bindAllowed.add(port);
    const pendingSource = open(source.port, "source");
    await decide(service);
    const sourceClient = await pendingSource;
    const targetPort =
      scope === "single-host"
        ? source.echoPort
        : mode === "remote"
          ? source.echoPort
          : endpoint.echoPort;
    const c: TunnelConfig = {
      ...config(source.port),
      name: `matrix-${scope}-${mode}-${port}`,
      scope: "s2s",
      mode,
      sourcePassword: "fixture-only",
      endpointPassword: "fixture-only",
      endpointHost: scope === "single-host" ? "127.0.0.1" : "endpoint",
      endpointSSHPort: endpoint.port,
      sourcePort: scope === "two-host" && mode === "remote" ? targetPort : port,
      endpointPort:
        scope === "two-host" && mode === "remote" ? port : targetPort,
      bindHost: "127.0.0.1",
      targetHost: "127.0.0.1",
      maxRetries: 0,
      autoStart: false,
    };
    tunnelConfigs.set(c.name, c);
    cleanup.push(async () => {
      manualDisconnects.add(c.name);
      await cleanupTunnelResources(c.name, true);
      tunnelConfigs.delete(c.name);
      connectionStatus.delete(c.name);
    });
    if (scope === "single-host") await establishDirectTunnel(sourceClient, c);
    else {
      const pending = establishManagedS2STunnel(sourceClient, c, {
        password: "fixture-only",
        authMethod: "password",
      });
      void pending.catch(() => {});
      await decide(service);
      await pending;
    }
    expect(activeTunnelRuntimes.get(c.name)?.bindPort).toBe(port);
    const socket = connectTcp(port, "127.0.0.1");
    socket.on("error", () => {});
    cleanup.push(() => socket.destroy());
    await new Promise<void>((r, j) => {
      socket.once("connect", r);
      socket.once("error", j);
    });
    if (mode === "dynamic") {
      let reply = matrixRead(socket, 2);
      socket.write(Buffer.from([5, 1, 0]));
      expect(await reply).toEqual(Buffer.from([5, 0]));
      reply = matrixRead(socket, 10);
      socket.write(
        Buffer.from([
          5,
          1,
          0,
          1,
          127,
          0,
          0,
          1,
          targetPort >> 8,
          targetPort & 255,
        ]),
      );
      expect((await reply)[1]).toBe(0);
    }
    const payload = Buffer.concat([
      Buffer.from("中文\0binary\r\n"),
      Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)),
    ]);
    const received = matrixRead(socket, payload.length);
    socket.write(payload);
    expect(await received).toEqual(payload);
    expect(source.stats().execs + endpoint.stats().execs).toBe(0);
    expect(source.stats().denied + endpoint.stats().denied).toBe(0);
    if (scope === "two-host") {
      expect(source.stats().binds).toBe(mode === "remote" ? 0 : 1);
      expect(endpoint.stats().binds).toBe(mode === "remote" ? 1 : 0);
    }
    manualDisconnects.add(c.name);
    await cleanupTunnelResources(c.name, true);
    await vi.waitFor(() => expect(socket.destroyed).toBe(true));
    expect(activeTunnelRuntimes.has(c.name)).toBe(false);
    expect(activeRetryTimers.has(c.name)).toBe(false);
    const reused = createServer();
    await new Promise<void>((r, j) => {
      reused.once("error", j);
      reused.listen(port, "127.0.0.1", r);
    });
    await new Promise<void>((r) => reused.close(() => r()));
  },
  15000,
);
it.each([
  ["single-host", "local"],
  ["single-host", "remote"],
  ["single-host", "dynamic"],
  ["two-host", "local"],
  ["two-host", "remote"],
  ["two-host", "dynamic"],
] as const)(
  "reports an occupied %s %s listener without disturbing its owner",
  async (scope, mode) => {
    const service = trust(),
      source = await matrixSsh(),
      endpoint = await matrixSsh();
    source.allowed.add(endpoint.port);
    current.dns.mockResolvedValue(undefined);
    current.resolvedHost = {};
    const ownerSockets = new Set<Socket>(),
      occupied = createServer((socket) => {
        ownerSockets.add(socket);
        socket.on("error", () => {});
        socket.once("close", () => ownerSockets.delete(socket));
        socket.pipe(socket);
      });
    await new Promise<void>((r) => occupied.listen(0, "127.0.0.1", r));
    const port = (occupied.address() as { port: number }).port;
    source.bindAllowed.add(port);
    endpoint.bindAllowed.add(port);
    cleanup.push(async () => {
      for (const socket of ownerSockets) socket.destroy();
      await new Promise<void>((r) => occupied.close(() => r()));
    });
    const c: TunnelConfig = {
      ...config(source.port),
      name: `conflict-${mode}-${port}`,
      scope: "s2s",
      mode,
      sourcePort:
        scope === "two-host" && mode === "remote" ? source.echoPort : port,
      endpointPort:
        scope === "two-host" && mode === "remote"
          ? port
          : scope === "two-host"
            ? endpoint.echoPort
            : source.echoPort,
      endpointSSHPort: endpoint.port,
      endpointPassword: "fixture-only",
      sourcePassword: "fixture-only",
      endpointHost: scope === "two-host" ? "endpoint" : "127.0.0.1",
      bindHost: "127.0.0.1",
      targetHost: "127.0.0.1",
      maxRetries: 0,
      autoStart: false,
    };
    tunnelConfigs.set(c.name, c);
    cleanup.push(async () => {
      manualDisconnects.add(c.name);
      await cleanupTunnelResources(c.name, true);
      tunnelConfigs.delete(c.name);
      connectionStatus.delete(c.name);
    });
    await connectSSHTunnel(c);
    await decide(service);
    if (scope === "two-host") await decide(service);
    await vi.waitFor(
      () =>
        expect(connectionStatus.get(c.name)?.status).toBe(
          CONNECTION_STATES.FAILED,
        ),
      { timeout: 4000 },
    );
    expect(connectionStatus.get(c.name)?.connected).toBe(false);
    expect(connectionStatus.get(c.name)).toMatchObject({
      errorType: "CONNECTION_FAILED",
    });
    expect(connectionStatus.get(c.name)?.reason).toBeTruthy();
    expect(activeTunnelRuntimes.has(c.name)).toBe(false);
    expect(activeRetryTimers.has(c.name)).toBe(false);
    await vi.waitFor(() => {
      expect(source.clients()).toBe(0);
      expect(endpoint.clients()).toBe(0);
    });
    const socket = connectTcp(port, "127.0.0.1");
    socket.on("error", () => {});
    cleanup.push(() => socket.destroy());
    const received = matrixRead(socket, 5);
    socket.once("connect", () => socket.write("owner"));
    expect((await received).toString()).toBe("owner");
  },
  15000,
);
it.each(["local", "remote", "dynamic"] as const)(
  "relays real %s C2S data through its actual WebSocket handler",
  async (mode) => {
    const service = trust(),
      source = await matrixSsh(),
      port = await matrixPort();
    source.bindAllowed.add(port);
    current.resolvedHost = {
      id: 7,
      userId: "requester",
      name: "relay-fixture",
      ip: "127.0.0.1",
      port: source.port,
      username: "fixture",
      authType: "password",
      password: "fixture-only",
    };
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    let relay!: WebSocket;
    const connected = new Promise<void>((r) =>
      wss.once("connection", (ws) => {
        relay = ws;
        r();
      }),
    );
    const browser = new WebSocket(
      "ws://127.0.0.1:" + (wss.address() as { port: number }).port,
    );
    browser.on("error", () => {});
    const locals = new Map<string, Socket>();
    cleanup.push(async () => {
      browser.terminate();
      relay?.terminate();
      for (const socket of locals.values()) socket.destroy();
      await new Promise<void>((r) => wss.close(() => r()));
    });
    await connected;
    const ready = new Promise<void>((resolve, reject) =>
      browser.on("message", (data, binary) => {
        if (!binary) {
          const m = JSON.parse(data.toString());
          if (m.type === "ready") resolve();
          if (m.type === "error") reject(Error(m.error));
        }
      }),
    );
    if (mode === "remote")
      browser.on("message", (data, binary) => {
        if (binary) return;
        const m = JSON.parse(data.toString());
        if (m.type === "connection") {
          const socket = connectTcp(source.echoPort, "127.0.0.1");
          locals.set(m.streamId, socket);
          socket.on("error", () => {});
          socket.on("data", (bytes) => {
            if (browser.readyState === 1)
              browser.send(
                JSON.stringify({
                  type: "data",
                  streamId: m.streamId,
                  data: bytes.toString("base64"),
                }),
              );
          });
        } else if (m.type === "data") {
          locals.get(m.streamId)?.write(Buffer.from(m.data, "base64"));
        } else if (m.type === "close") {
          locals.get(m.streamId)?.destroy();
          locals.delete(m.streamId);
        }
      });
    const opening = handleC2SRelayOpen(
      relay,
      {
        type: "open",
        targetHost: "127.0.0.1",
        targetPort: source.echoPort,
        tunnelConfig: {
          sourceHostId: 7,
          mode,
          sourcePort: port,
          endpointPort: source.echoPort,
          targetHost: "127.0.0.1",
        },
      },
      "requester",
    );
    void opening.catch(() => {});
    await decide(service);
    await opening;
    await ready;
    const payload = Buffer.concat([
      Buffer.from("C2S中文\0"),
      Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256)),
    ]);
    if (mode === "remote") {
      const socket = connectTcp(port, "127.0.0.1");
      socket.on("error", () => {});
      cleanup.push(() => socket.destroy());
      const result = matrixRead(socket, payload.length);
      socket.once("connect", () => socket.write(payload));
      expect(await result).toEqual(payload);
    } else {
      const received = new Promise<Buffer>((resolve) => {
        let bytes = Buffer.alloc(0);
        browser.on("message", (data, binary) => {
          if (binary) {
            bytes = Buffer.concat([bytes, Buffer.from(data as Buffer)]);
            if (bytes.length >= payload.length) resolve(bytes);
          }
        });
      });
      browser.send(payload);
      expect(await received).toEqual(payload);
    }
    browser.close();
    await vi.waitFor(() => expect(source.clients()).toBe(0));
    expect(source.stats().execs).toBe(0);
    if (mode === "remote") {
      const reused = createServer();
      await new Promise<void>((r, j) => {
        reused.once("error", j);
        reused.listen(port, "127.0.0.1", r);
      });
      await new Promise<void>((r) => reused.close(() => r()));
    }
  },
  15000,
);
it("honors zero retries after a live tunnel loses its SSH connection", async () => {
  const service = trust(),
    source = await matrixSsh(),
    port = await matrixPort();
  current.dns.mockResolvedValue(undefined);
  current.resolvedHost = {};
  const c: TunnelConfig = {
    ...config(source.port),
    name: "drop-" + port,
    scope: "s2s",
    mode: "local",
    sourcePort: port,
    endpointPort: source.echoPort,
    endpointHost: "127.0.0.1",
    targetHost: "127.0.0.1",
    sourcePassword: "fixture-only",
    maxRetries: 0,
    retryInterval: 100,
  };
  tunnelConfigs.set(c.name, c);
  cleanup.push(async () => {
    manualDisconnects.add(c.name);
    await cleanupTunnelResources(c.name, true);
    tunnelConfigs.delete(c.name);
    connectionStatus.delete(c.name);
  });
  await connectSSHTunnel(c);
  await decide(service);
  await vi.waitFor(() =>
    expect(connectionStatus.get(c.name)?.connected).toBe(true),
  );
  source.disconnectClients();
  await vi.waitFor(() =>
    expect(connectionStatus.get(c.name)?.status).toBe(CONNECTION_STATES.FAILED),
  );
  expect(activeRetryTimers.has(c.name)).toBe(false);
  expect(activeTunnelRuntimes.has(c.name)).toBe(false);
}, 10000);
