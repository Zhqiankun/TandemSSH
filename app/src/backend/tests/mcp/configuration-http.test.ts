import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { PairingRegistry } from "../../mcp/pairing-registry.js";
import { buildClientConfiguration } from "../../mcp/client-configuration.js";
const state = vi.hoisted(() => ({
  registry: undefined as unknown as PairingRegistry,
  start: vi.fn(),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({
    listDecryptedByUserId: async () => [],
  }),
}));
vi.mock("../../mcp/production.js", () => ({
  pairingRegistry: {
    list: (user: string) => state.registry.list(user),
    create: (...args: Parameters<PairingRegistry["create"]>) =>
      state.registry.create(...args),
    revoke: (...args: Parameters<PairingRegistry["revoke"]>) =>
      state.registry.revoke(...args),
  },
  startMcpBridge: state.start,
  clientConfiguration: (user: string, client: string) =>
    buildClientConfiguration(
      {
        list: (owner) => state.registry.list(owner),
        start: state.start,
        executable: "C:\\TandemSSH\\node.exe",
        entry: "C:\\TandemSSH\\stdio.js",
      },
      user,
      client,
    ),
  desktopSessionRequests: {},
}));
import router from "../../mcp/http-routes.js";
let server: Server, url: string, clientId: string, profileId: string;
let secret: Uint8Array;
const readSecret = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  const settings = new Map<string, string>(),
    secrets = new Map<string, Uint8Array>();
  state.registry = new PairingRegistry(
    {
      get: (key) => settings.get(key),
      set: async (key, value) => {
        settings.set(key, value);
      },
      ownsHost: async (user, id) => user === "owner" && id === 7,
      audit: async () => {},
      revoke: () => {},
    },
    {
      read: readSecret,
      write: async (ref, value) => {
        secrets.set(ref.clientId, Uint8Array.from(value));
      },
      remove: async (ref) => secrets.delete(ref.clientId),
    },
  );
  const client = await state.registry.create("owner", {
    name: "Codex",
    allowedHostIds: [7],
    readTerminal: false,
  });
  clientId = client.id;
  secret = secrets.get(clientId)!;
  profileId = await state.registry.initialize();
  state.start.mockResolvedValue({ profileId });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      userId: req.header("x-test-user"),
      apiKeyId: req.header("x-test-api-key"),
    });
    next();
  });
  app.use("/mcp", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const request = (id = clientId, user = "owner", apiKey = false) =>
  fetch(url + "/mcp/clients/" + id + "/configuration", {
    headers: {
      "x-test-user": user,
      ...(apiKey ? { "x-test-api-key": "test-key" } : {}),
    },
  });
it("exports only executable and public references for an enabled owned pairing", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toEqual({
    command: "C:\\TandemSSH\\node.exe",
    args: [
      "C:\\TandemSSH\\stdio.js",
      "--profile",
      profileId,
      "--client",
      clientId,
    ],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
  expect(JSON.stringify(data)).not.toContain(
    Buffer.from(secret).toString("base64"),
  );
  expect(JSON.stringify(data)).not.toContain(
    Buffer.from(secret).toString("hex"),
  );
  expect(readSecret).not.toHaveBeenCalled();
});
it.each(["other-owner", "unknown", "revoked"])(
  "rejects %s without starting the bridge or reading the pairing secret",
  async (kind) => {
    if (kind === "revoked") await state.registry.revoke("owner", clientId);
    const response = await request(
      kind === "unknown" ? randomUUID() : clientId,
      kind === "other-owner" ? "other" : "owner",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "MCP_CLIENT_NOT_FOUND" });
    expect(state.start).not.toHaveBeenCalled();
    expect(readSecret).not.toHaveBeenCalled();
  },
);
it.each(["anonymous", "api-key"])(
  "rejects %s at the route's human identity guard",
  async (kind) => {
    const response = await request(
      clientId,
      kind === "anonymous" ? "" : "owner",
      kind === "api-key",
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "TRUSTED_UI_REQUIRED" });
    expect(state.start).not.toHaveBeenCalled();
  },
);
it("does not return a configuration if the pairing is revoked while the bridge starts", async () => {
  let finish!: (value: { profileId: string }) => void;
  state.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = request();
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
  await state.registry.revoke("owner", clientId);
  finish({ profileId });
  const response = await pending;
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "MCP_CLIENT_NOT_FOUND" });
  expect(readSecret).not.toHaveBeenCalled();
});
