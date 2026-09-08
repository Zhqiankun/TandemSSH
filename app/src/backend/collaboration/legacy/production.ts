import { sessionManager } from "../../hosts/terminal/session-manager.js";
import { createCurrentHostRepository } from "../../database/repositories/factory.js";
import { taskRuntime } from "../tasks/production.js";
import { LegacyCommandService, type LegacyTarget } from "./service.js";
export function legacySessionForHost(userId: string, hostId: number) {
  const sessions = sessionManager
    .getUserSessions(userId)
    .filter((s) => s.hostId === hostId && s.isConnected && !!s.sshStream);
  if (sessions.length !== 1)
    throw Error(
      sessions.length ? "LEGACY_SESSION_AMBIGUOUS" : "SHARED_SESSION_REQUIRED",
    );
  return sessions[0].id;
}
export async function legacyTarget(
  userId: string,
  id: string,
): Promise<LegacyTarget> {
  const session = sessionManager.getSession(id);
  if (!session?.isConnected || !session.sshStream || session.userId !== userId)
    throw Error("SESSION_NOT_FOUND");
  const repo = createCurrentHostRepository(),
    facts = repo.readOwnedPolicyScope(userId, session.hostId);
  if (!facts || facts.identity !== session.hostName)
    throw Error("HOST_CONFIGURATION_CHANGED");
  const host = await repo.findDecryptedByIdAs(userId, session.hostId);
  if (!host || host.userId !== userId) throw Error("HOST_NOT_FOUND");
  return {
    hostId: session.hostId,
    hostName: session.hostName,
    host: {
      ip: host.ip,
      username: host.username,
      port: host.port || 22,
      name: host.name || host.ip,
    },
    control: session.control.snapshot(),
  };
}
export const legacyCommands = new LegacyCommandService({
  tasks: taskRuntime,
  target: legacyTarget,
  notify: (sessionId, taskId) =>
    sessionManager.broadcast(sessionId, {
      type: "collaboration.task.created",
      sessionId,
      taskId,
    }),
});
