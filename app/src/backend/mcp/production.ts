import {
  fileAutomation,
  transferAutomation,
  directoryAutomation,
} from "../collaboration/files/production.js";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runtimePolicy } from "../runtime/policy.js";
import { sessionManager } from "../hosts/terminal/session-manager.js";
import {
  createCurrentHostRepository,
  createCurrentSettingsRepository,
  getCurrentSettingValue,
} from "../database/repositories/factory.js";
import {
  taskRuntime,
  listSessions,
  journalFor,
} from "../collaboration/tasks/production.js";
import { SystemPairingSecretStore } from "./credential-store.js";
import { PairingRegistry } from "./pairing-registry.js";
import { LocalBridgeServer, type BridgePrincipal } from "./bridge/server.js";
import { localBridgeEndpoint } from "./bridge/endpoint.js";
import { DesktopSessionRequests } from "./session-requests.js";
import { McpCore } from "./core.js";
import { workflows } from "../collaboration/workflows/production.js";
import type { McpClientConfiguration } from "../../types/mcp-pairing.js";
let running: LocalBridgeServer | undefined;
const activeConnections = new Set<string>();
let startup: Promise<{ profileId: string }> | undefined;
export const pairingRegistry = new PairingRegistry(
  {
    get: (key) => getCurrentSettingValue(key) ?? undefined,
    set: async (key, value) => {
      await createCurrentSettingsRepository().set(key, value);
    },
    ownsHost: async (userId, id) =>
      !!(await createCurrentHostRepository().findByIdForUser(userId, id)),
    audit: (userId, type, data) => journalFor(userId).record(type, data),
    revoke: (clientId) => running?.disconnect(clientId),
  },
  new SystemPairingSecretStore(),
);
function actor(principal: BridgePrincipal) {
  return { kind: "mcp" as const, ...principal };
}
export const desktopSessionRequests = new DesktopSessionRequests({
  allowed: (principal) =>
    activeConnections.has(principal.connectionId) &&
    pairingRegistry.isAllowed(principal),
  connected(principal, hostId, instanceId) {
    const session = sessionManager
      .getUserSessions(principal.userId)
      .find(
        (item) =>
          item.hostId === hostId &&
          item.isConnected &&
          !!item.sshStream &&
          (!instanceId ||
            item.tabInstanceId === instanceId ||
            item.attachedTabInstanceId === instanceId),
      );
    return session
      ? { id: session.id, control: session.control.snapshot() }
      : undefined;
  },
});
const core = new McpCore({
  files: fileAutomation,
  transfers: transferAutomation,
  directories: directoryAutomation,
  tasks: taskRuntime,
  workflows,
  async hosts(principal) {
    const hosts = await createCurrentHostRepository().listDecryptedByUserId(
      principal.userId,
    );
    return hosts
      .filter((host) => principal.allowedHostIds.includes(host.id))
      .map((host) => ({
        id: host.id,
        name: host.name || host.ip,
        address: host.ip,
        port: host.port || 22,
      }));
  },
  sessions: (principal) => listSessions(actor(principal)),
  output(principal, id) {
    const session = sessionManager.getSession(id);
    if (
      !session ||
      session.userId !== principal.userId ||
      !principal.allowedHostIds.includes(session.hostId)
    )
      throw new Error("SESSION_NOT_FOUND");
    return {
      text: sessionManager.getBuffer(session) ?? "",
      cursor: session.outputSequence,
      firstCursor: session.outputSequence - session.outputBuffer.length,
      generation: session.control.snapshot().generation,
    };
  },
  async open(principal, hostId, requestId) {
    if (
      !(await createCurrentHostRepository().findByIdForUser(
        principal.userId,
        hostId,
      ))
    )
      throw new Error("HOST_NOT_FOUND");
    return desktopSessionRequests.open(principal, hostId, requestId);
  },
});
export function startMcpBridge(): Promise<{ profileId: string }> {
  if (!runtimePolicy.desktop)
    return Promise.reject(new Error("MCP_DESKTOP_REQUIRED"));
  if (!startup)
    startup = (async () => {
      const profileId = await pairingRegistry.initialize();
      const server = new LocalBridgeServer({
        profileId,
        authenticate: (id) => pairingRegistry.authenticate(id),
        isAllowed: (principal) => pairingRegistry.isAllowed(principal),
        connected: (principal) => {
          activeConnections.add(principal.connectionId);
          taskRuntime.connectClient(principal.connectionId);
        },
        disconnected: (principal) => {
          activeConnections.delete(principal.connectionId);
          taskRuntime.disconnectClient(principal.connectionId);
        },
        invoke: (...args) => core.invoke(...args),
      });
      const endpoint = localBridgeEndpoint(profileId);
      await server.listen(endpoint);
      if (process.platform !== "win32") await fs.chmod(endpoint, 0o600);
      running = server;
      return { profileId };
    })().catch((error) => {
      startup = undefined;
      throw error;
    });
  return startup;
}
export async function stopMcpBridge(): Promise<void> {
  const server = running;
  running = undefined;
  startup = undefined;
  await server?.close();
}
export async function clientConfiguration(
  userId: string,
  clientId: string,
): Promise<McpClientConfiguration> {
  const { profileId } = await startMcpBridge();
  if (
    !pairingRegistry
      .list(userId)
      .some((client) => client.id === clientId && client.enabled)
  )
    throw new Error("MCP_CLIENT_NOT_FOUND");
  return {
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./stdio.js", import.meta.url)),
      "--profile",
      profileId,
      "--client",
      clientId,
    ],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
