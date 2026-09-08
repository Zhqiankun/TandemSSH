import { WorkflowLibrary } from "./library.js";
import { taskRuntime, readPolicy, journalFor } from "../tasks/production.js";
import {
  createCurrentSettingsRepository,
  createCurrentHostRepository,
  getCurrentSettingValue,
} from "../../database/repositories/factory.js";
import { sessionManager } from "../../hosts/terminal/session-manager.js";
import type { TaskActor } from "../tasks/runtime.js";
export function workflowTarget(actor: TaskActor, sessionId: string) {
  const session = sessionManager.getSession(sessionId);
  if (
    !session?.isConnected ||
    session.userId !== actor.userId ||
    (actor.kind === "mcp" && !actor.allowedHostIds.includes(session.hostId))
  )
    throw new Error("SESSION_NOT_FOUND");
  const facts = createCurrentHostRepository().readOwnedPolicyScope(
    actor.userId,
    session.hostId,
  );
  if (!facts || facts.identity !== session.hostName)
    throw new Error("HOST_CONFIGURATION_CHANGED");
  const parts = facts.folder.split("/").filter(Boolean);
  return {
    hostId: session.hostId,
    groups: [
      ...parts.map((_, i) => parts.slice(0, i + 1).join("/")),
      ...facts.tags.map((tag) => "tag:" + tag),
    ],
    control: session.control.snapshot(),
  };
}
export const workflows = new WorkflowLibrary({
  read: (userId) =>
    getCurrentSettingValue("tandem-workflows:" + userId) ?? undefined,
  write: async (userId, value) => {
    await createCurrentSettingsRepository().set(
      "tandem-workflows:" + userId,
      value,
    );
  },
  ownsHost: async (userId, hostId) =>
    !!(await createCurrentHostRepository().findByIdForUser(userId, hostId)),
  target: workflowTarget,
  policy: readPolicy,
  tasks: taskRuntime,
  audit: (userId, type, data) => journalFor(userId).record(type, data),
});
