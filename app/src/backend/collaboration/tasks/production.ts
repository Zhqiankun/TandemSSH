import { automatedTransfers } from "../../files/automated-transfer-production.js";
import {
  bindLocalTaskContext,
  localFileGrants,
} from "../../files/local-file-production.js";
import { automatedDocuments } from "../../files/production.js";
import { hostFileFence } from "../sessions/host-file-fence.js";
import { sessionManager } from "../../hosts/terminal/session-manager.js";
import {
  getCurrentSettingValue,
  createCurrentSettingsRepository,
  createCurrentHostRepository,
} from "../../database/repositories/factory.js";
import { PtyCommandExecutor } from "../adapters/pty-command.js";
import { TaskRuntime, type TaskActor } from "./runtime.js";
import { journalFor } from "../audit/production.js";
export { journalFor } from "../audit/production.js";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations.js";

import {
  validatePolicySnapshot,
  validatePolicySets,
} from "../policies/schema.js";

const updating = new Set<string>();
const key = (userId: string) => `tandem-policy:${userId}`;
export function readPolicy(userId: string): CommandPolicySnapshot {
  const raw = getCurrentSettingValue(key(userId));
  if (raw) {
    try {
      return validatePolicySnapshot(JSON.parse(raw));
    } catch {
      throw new Error("POLICY_UNAVAILABLE");
    }
  }
  return {
    revision: 1,
    sets: [
      {
        id: "default",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: ["reboot", "shutdown", "mkfs", "dd"].map((program) => ({
          id: `deny-${program}`,
          effect: "deny",
          match: { kind: "program", program },
          reason: "默认禁止整机重启、关机和磁盘破坏操作",
        })),
      },
    ],
  };
}
export const taskRuntime = new TaskRuntime({
  validateFileBinding: (userId, taskId, action) =>
    localFileGrants.assert(
      taskRuntime.fileObservationContext({ kind: "human", userId }, taskId),
      action,
    ),
  releaseTransferProgress: (userId, taskId, operationId) =>
    automatedTransfers.forget(
      taskRuntime.fileObservationContext({ kind: "human", userId }, taskId),
      operationId,
    ),
  fileReviewValid: (...args) => automatedDocuments.validReview(...args),
  notifyTask(sessionId, taskId) {
    sessionManager.broadcast(sessionId, {
      type: "collaboration.task.created",
      sessionId,
      taskId,
    });
  },
  getSession(id) {
    const session = sessionManager.getSession(id);
    if (!session?.isConnected || !session.sshStream) return null;
    return {
      assertAvailable: () =>
        hostFileFence.assertAvailable({
          userId: session.userId,
          hostId: session.hostId,
          identity: session.hostName,
        }),
      id: session.id,
      userId: session.userId,
      hostId: session.hostId,
      hostName: session.hostName,
      groups: () => {
        const facts = createCurrentHostRepository().readOwnedPolicyScope(
          session.userId,
          session.hostId,
        );
        if (!facts || facts.identity !== session.hostName)
          throw new Error("HOST_CONFIGURATION_CHANGED");
        const parts = facts.folder.split("/").filter(Boolean);
        return [
          ...parts.map((_, index) => parts.slice(0, index + 1).join("/")),
          ...facts.tags.map((tag) => "tag:" + tag),
        ];
      },
      control: session.control,
      files: automatedTransfers.executor(
        session.userId,
        session.id,
        automatedDocuments.executor(session.userId, session.id),
      ),
      executor: new PtyCommandExecutor(
        () => sessionManager.getSession(id)?.sshStream ?? null,
      ),
    };
  },
  policy: async (userId) => {
    if (updating.has(userId)) throw new Error("POLICY_UPDATING");
    return readPolicy(userId);
  },
  audit: journalFor,
});
bindLocalTaskContext((userId, taskId) =>
  taskRuntime.localFileContext({ kind: "human", userId }, taskId),
);
export function listSessions(actor: TaskActor) {
  return sessionManager
    .getUserSessions(actor.userId)
    .filter(
      (session) =>
        actor.kind !== "mcp" || actor.allowedHostIds.includes(session.hostId),
    )
    .map((session) => ({
      id: session.id,
      hostId: session.hostId,
      hostName: session.hostName,
      connected: session.isConnected,
      control: session.control.snapshot(),
    }));
}
export async function savePolicy(
  userId: string,
  expectedRevision: number,
  sets: CommandPolicySnapshot["sets"],
): Promise<CommandPolicySnapshot> {
  if (updating.has(userId)) throw new Error("POLICY_UPDATING");
  const current = readPolicy(userId);
  if (expectedRevision !== current.revision) throw new Error("POLICY_CHANGED");
  const next = {
    revision: current.revision + 1,
    sets: validatePolicySets(sets),
  };
  updating.add(userId);
  // Revoke all outstanding task approvals before an asynchronous policy write.
  for (const session of sessionManager.getUserSessions(userId)) {
    if (!session.control.snapshot().closed) session.control.takeover();
  }
  try {
    await journalFor(userId).record("policy.save-requested", {
      expectedRevision,
      revision: next.revision,
      sets: next.sets,
    });
    await createCurrentSettingsRepository().set(
      key(userId),
      JSON.stringify(next),
    );
  } finally {
    updating.delete(userId);
  }
  return next;
}
