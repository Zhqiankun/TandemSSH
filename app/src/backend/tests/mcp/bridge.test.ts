import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createConnection } from "node:net";
import {
  LocalBridgeServer,
  type BridgePrincipal,
} from "../../mcp/bridge/server.js";
import { LocalBridgeClient } from "../../mcp/bridge/client.js";
import {
  mac,
  seal,
  unseal,
  send,
  receive,
  type HandshakeContext,
} from "../../mcp/bridge/protocol.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
const profileId = "11111111-1111-4111-8111-111111111111",
  clientId = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const secret = randomBytes(32);
  let allowed = true;
  const connected: BridgePrincipal[] = [],
    disconnected: BridgePrincipal[] = [];
  const invoke = vi.fn(
    async (
      _principal: BridgePrincipal,
      _method: string,
      _parameters: Record<string, unknown>,
      _signal: AbortSignal,
    ) => ({ state: "ready", output: "同舟测试" }),
  );
  const isAllowed = vi.fn(() => allowed);
  const server = new LocalBridgeServer({
    profileId,
    authenticate: async (id) =>
      id === clientId
        ? {
            secret,
            identity: {
              clientId,
              userId: "owner",
              allowedHostIds: [7],
              readTerminal: false,
            },
          }
        : null,
    isAllowed,
    connected: (p) => {
      connected.push(p);
    },
    disconnected: (p) => {
      disconnected.push(p);
    },
    invoke,
  });
  const base = path.resolve(process.cwd(), "../.cache/mcp-pipes");
  await fs.mkdir(base, { recursive: true });
  const endpoint =
    process.platform === "win32"
      ? "\\\\.\\pipe\\tandem-test-" + randomUUID()
      : path.join(base, randomUUID() + ".sock");
  await server.listen(endpoint);
  closers.push(() => server.close());
  const secrets = {
    read: async () => secret,
    write: async () => {},
    remove: async () => true,
  };
  const connect = async () => {
    const client = await LocalBridgeClient.connect(
      endpoint,
      { profileId, clientId },
      secrets,
    );
    closers.push(async () => client.close());
    return client;
  };
  return {
    server,
    secret,
    secrets,
    endpoint,
    connected,
    disconnected,
    invoke,
    isAllowed,
    connect,
    revoke: () => {
      allowed = false;
      server.disconnect(clientId);
    },
  };
}
describe("authenticated local MCP bridge", () => {
  it("binds requests to the registered identity and carries Chinese data over a real OS pipe", async () => {
    const f = await fixture(),
      client = await f.connect();
    expect(await client.invoke("status", {})).toEqual({
      state: "ready",
      output: "同舟测试",
    });
    expect(f.invoke.mock.calls[0][0]).toMatchObject({
      userId: "owner",
      clientId,
      allowedHostIds: [7],
      readTerminal: false,
    });
    expect(f.connected[0].connectionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.secret.some((byte) => byte !== 0)).toBe(true);
  });
  it("rejects wrong pairing secrets before any core call", async () => {
    const f = await fixture();
    await expect(
      LocalBridgeClient.connect(
        f.endpoint,
        { profileId, clientId },
        { ...f.secrets, read: async () => randomBytes(32) },
      ),
    ).rejects.toThrow();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.connected).toHaveLength(0);
  });
  it("rejects identities and approval methods injected by a paired client", async () => {
    const f = await fixture(),
      client = await f.connect();
    expect(() => client.invoke("status", { origin: "human" })).toThrow(
      "INVALID_REQUEST",
    );
    expect(() => client.invoke("grant_control" as never, {})).toThrow(
      "MCP_METHOD_NOT_ALLOWED",
    );
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("revocation closes the authenticated connection and reports lifecycle loss", async () => {
    const f = await fixture(),
      client = await f.connect();
    f.revoke();
    await vi.waitFor(() => expect(f.disconnected).toHaveLength(1));
    await expect(client.invoke("status", {})).rejects.toThrow(
      "MCP_DISCONNECTED",
    );
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("rechecks revocation between request scheduling and the core callback", async () => {
    const f = await fixture(),
      client = await f.connect();
    f.isAllowed.mockImplementationOnce(() => {
      queueMicrotask(f.revoke);
      return true;
    });
    await expect(client.invoke("status", {})).rejects.toThrow(
      "MCP_DISCONNECTED",
    );
    await vi.waitFor(() => expect(f.disconnected).toHaveLength(1));
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("revokes all pending calls, aborts their work, and suppresses late results", async () => {
    const f = await fixture();
    const signals: AbortSignal[] = [];
    const finish: Array<(value: { state: string; output: string }) => void> =
      [];
    f.invoke.mockImplementation(async (_p, _m, _args, signal) => {
      signals.push(signal);
      return new Promise((resolve) => finish.push(resolve));
    });
    const client = await f.connect();
    const pending = Promise.allSettled([
      client.invoke("status", {}),
      client.invoke("status", {}),
    ]);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    f.revoke();
    const results = await pending;
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason.message).toBe("MCP_DISCONNECTED");
    }
    await vi.waitFor(() =>
      expect(signals.every((signal) => signal.aborted)).toBe(true),
    );
    for (const resolve of finish)
      resolve({ state: "done", output: "late-result-must-not-return" });
    await expect(client.invoke("status", {})).rejects.toThrow(
      "MCP_DISCONNECTED",
    );
    await expect(f.connect()).rejects.toThrow();
    expect(f.invoke).toHaveBeenCalledTimes(2);
    expect(f.connected).toHaveLength(1);
    expect(
      f.disconnected.filter(
        (p) => p.connectionId === f.connected[0].connectionId,
      ),
    ).toHaveLength(1);
  });
  it("aborting a pending call closes the client instead of silently replaying it", async () => {
    const f = await fixture();
    let release!: (value: { state: string; output: string }) => void;
    f.invoke.mockImplementation(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const client = await f.connect(),
      controller = new AbortController();
    const pending = client.invoke("status", {}, controller.signal);
    await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toThrow("MCP_DISCONNECTED");
    await vi.waitFor(() => expect(f.disconnected).toHaveLength(1));
    release({ state: "done", output: "late" });
  });
  it("closes on a replayed signed request, without dispatching a second action", async () => {
    const f = await fixture();
    const socket = createConnection(f.endpoint);
    socket.on("error", () => {});
    closers.push(async () => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const incoming = receive(socket),
      clientNonce = randomBytes(32).toString("hex");
    send(socket, { kind: "hello", profileId, clientId, clientNonce });
    const challenge = (await incoming.next()).value as {
      serverNonce: string;
      connectionId: string;
    };
    const context = {
      profileId,
      clientId,
      clientNonce,
      serverNonce: challenge.serverNonce,
      connectionId: challenge.connectionId,
    };
    send(socket, {
      kind: "proof",
      mac: mac(f.secret, context, "client-proof", null),
    });
    await incoming.next();
    const frame = seal(f.secret, context, "client", 1, {
      id: 1,
      method: "status",
      parameters: {},
    });
    send(socket, frame);
    await incoming.next();
    send(socket, frame);
    await vi.waitFor(() => expect(f.disconnected).toHaveLength(1));
    expect(f.invoke).toHaveBeenCalledTimes(1);
  });
});
describe("signed frame boundaries", () => {
  const context: HandshakeContext = {
    profileId,
    clientId,
    clientNonce: "a".repeat(64),
    serverNonce: "b".repeat(64),
    connectionId: "33333333-3333-4333-8333-333333333333",
  };
  it("rejects body tampering, direction reflection, wrong sequence and another connection", () => {
    const secret = randomBytes(32),
      frame = seal(secret, context, "client", 1, { command: "pwd" });
    expect(unseal(secret, context, "client", 1, frame)).toEqual({
      command: "pwd",
    });
    for (const check of [
      () =>
        unseal(secret, context, "client", 1, {
          ...frame,
          payload: '{"command":"reboot"}',
        }),
      () => unseal(secret, context, "server", 1, frame),
      () => unseal(secret, context, "client", 2, frame),
      () =>
        unseal(
          secret,
          { ...context, connectionId: randomUUID() },
          "client",
          1,
          frame,
        ),
    ])
      expect(check).toThrow("MCP_MESSAGE_AUTHENTICATION_FAILED");
  });
});
