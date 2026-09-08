import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Client, Server } from "ssh2";
import { HostTrustService } from "../../hosts/trust/service";
import type { HostTrustRecord } from "../../../types/host-trust";
const state = vi.hoisted(() => ({
  service: undefined as HostTrustService | undefined,
}));
vi.mock("../../hosts/trust/production.js", () => ({
  hostTrust: {
    verify: (...args: Parameters<HostTrustService["verify"]>) =>
      state.service!.verify(...args),
    report: (...args: Parameters<HostTrustService["report"]>) =>
      state.service!.report(...args),
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostKeyVerificationData: async () => ({
      hostKeyFingerprint: null,
      hostKeyType: null,
      hostKeyAlgorithm: null,
      hostKeyChangedCount: 0,
      name: "本机测试",
    }),
  }),
}));
vi.mock("../../utils/logger.js", () => ({ sshLogger: { error: vi.fn() } }));
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  state.service?.dispose();
});
function setup() {
  const records = new Map<string, HostTrustRecord>();
  state.service = new HostTrustService({
    store: {
      get: async (id, userId) => {
        const r = records.get(id);
        return r?.userId === userId ? r : undefined;
      },
      compareAndSet: async (r, revision) => {
        if ((records.get(r.id)?.revision ?? 0) !== revision)
          throw Error("HOST_TRUST_RECORD_CHANGED");
        records.set(r.id, r);
      },
    },
    audit: async () => {},
  });
  return state.service;
}
async function server(port = 0) {
  let auth = 0;
  const clients = new Set<{ end(): void }>(),
    key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
      { format: "pem", type: "pkcs1" },
    ),
    ssh = new Server({ hostKeys: [key] }, (client) => {
      clients.add(client);
      client.on("error", () => {});
      client.on("authentication", (ctx) => {
        auth++;
        if (ctx.method === "password" && ctx.password === "fixture-only")
          ctx.accept();
        else ctx.reject();
      });
      client.on("close", () => clients.delete(client));
    });
  await new Promise<void>((resolve, reject) => {
    ssh.once("error", reject);
    ssh.listen(port, "127.0.0.1", resolve);
  });
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    for (const c of clients) c.end();
    await new Promise<void>((resolve) => ssh.close(() => resolve()));
  };
  cleanup.push(stop);
  return {
    port: (ssh.address() as { port: number }).port,
    auth: () => auth,
    stop,
  };
}
async function connect(
  port: number,
  hostId: number | null = null,
  jump = false,
) {
  const client = new Client();
  cleanup.push(() => client.end());
  const verifier = await SSHHostKeyVerifier.createHostVerifier(
    hostId,
    "127.0.0.1",
    port,
    null,
    "owner",
    jump,
    undefined,
    client,
  );
  const ready = new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.on("error", reject);
    client.once("close", () => reject(Error("CLIENT_CLOSED")));
    client.connect({
      host: "127.0.0.1",
      port,
      username: "fixture",
      password: "fixture-only",
      readyTimeout: 6000,
      hostVerifier: verifier,
    });
  });
  void ready.catch(() => {});
  return { client, ready };
}
async function accept(service: HostTrustService) {
  await vi.waitFor(() =>
    expect(service.list("owner").requests).toHaveLength(1),
  );
  const p = service.list("owner").requests[0];
  return service.decide("owner", {
    requestId: p.id,
    fingerprint: p.fingerprint,
    expectedRevision: p.expectedRevision,
    action: "trust",
    verified: true,
  });
}
describe("actual SSH handshake trust", () => {
  it.each([
    { id: null, jump: false },
    { id: 7, jump: false },
    { id: 7, jump: true },
  ])(
    "blocks credentials until human approval for %j without a WebSocket",
    async (cfg) => {
      const trust = setup(),
        ssh = await server(),
        connection = await connect(ssh.port, cfg.id, cfg.jump);
      await vi.waitFor(() =>
        expect(trust.list("owner").requests).toHaveLength(1),
      );
      expect(ssh.auth()).toBe(0);
      await accept(trust);
      await connection.ready;
      expect(ssh.auth()).toBeGreaterThan(0);
    },
    10000,
  );
  it("rejects a changed server at the same address, then uses the new pin only on a fresh connection", async () => {
    const trust = setup(),
      old = await server(),
      a = await connect(old.port);
    await accept(trust);
    await a.ready;
    a.client.end();
    await old.stop();
    const next = await server(old.port),
      b = await connect(next.port);
    await expect(b.ready).rejects.toThrow();
    expect(next.auth()).toBe(0);
    await vi.waitFor(() =>
      expect(trust.list("owner").requests).toHaveLength(1),
    );
    expect(trust.list("owner").requests[0].connectionStopped).toBe(true);
    expect((await accept(trust)).reconnectRequired).toBe(true);
    const c = await connect(next.port);
    await c.ready;
    expect(next.auth()).toBeGreaterThan(0);
  }, 15000);
  it("removes the pending first-use prompt after its SSH client closes", async () => {
    const trust = setup(),
      ssh = await server(),
      connection = await connect(ssh.port);
    await vi.waitFor(() =>
      expect(trust.list("owner").requests).toHaveLength(1),
    );
    connection.client.end();
    await expect(connection.ready).rejects.toThrow();
    await vi.waitFor(() =>
      expect(trust.list("owner").requests).toHaveLength(0),
    );
    expect(ssh.auth()).toBe(0);
  }, 10000);
});
