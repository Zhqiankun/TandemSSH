import type {
  AgentTaskRecoveryPort,
  RecoveredAgentTask,
} from "./agent-port.js";
import type { TaskRuntime, TaskActor } from "../tasks/runtime.js";
import type { TaskRecoveryStore } from "./store.js";
import type { TaskRecoveryRecord } from "./schema.js";
import { readCheckpoint } from "./schema.js";
import { redact } from "../../privacy/redaction.js";
import type {
  TaskRecoveryDetail,
  TaskRecoverySummary,
} from "../../../types/task-recovery.js";
export class TaskRecoveryService {
  constructor(
    private tasks: TaskRuntime,
    private store: TaskRecoveryStore,
    private agents?: AgentTaskRecoveryPort,
  ) {}
  private canRead(actor: TaskActor, row: TaskRecoveryRecord) {
    return (
      row.userId === actor.userId &&
      (actor.kind === "human" ||
        (actor.kind === "mcp" &&
          row.checkpoint.source === "mcp" &&
          row.checkpoint.clientId === actor.clientId &&
          actor.allowedHostIds.includes(row.checkpoint.host.id)))
    );
  }
  private summary(row: TaskRecoveryRecord): TaskRecoverySummary {
    const c = row.checkpoint;
    return {
      directoryProgress: c.directoryState
        ? {
            completed: c.directoryState.completedEntryIds.length,
            entries: c.directoryState.entries,
          }
        : undefined,
      id: row.id,
      title: c.title,
      hostId: c.host.id,
      hostName: c.host.name,
      source: c.source,
      activeWorkflowName: c.workflowState?.runs.find(
        (r) => r.summary.id === c.workflowState?.activeRunId,
      )?.summary.name,
      mode: c.mode,
      nextStep: c.nextStep,
      stepCount: c.steps.length,
      reconciliationRequired: c.reconciliationRequired,
      resourceRecoveryRequired: c.resourceRecoveryRequired,
      state:
        row.state === "available" &&
        (c.completed ||
          (c.ai
            ? ["completed", "completed-with-errors"].includes(c.ai.view.phase)
            : !c.workflowState?.activeRunId &&
              c.steps.length > 0 &&
              c.nextStep === c.steps.length)) &&
        !c.reconciliationRequired
          ? "completed"
          : this.store.interrupted(row)
            ? "interrupted"
            : row.state === "live"
              ? "claimed"
              : row.state,
      savedAt: row.updatedAt,
    };
  }
  async list(actor: TaskActor) {
    return (await this.store.list(actor.userId))
      .filter((r) => this.canRead(actor, r))
      .map((r) => this.summary(r));
  }
  async detail(actor: TaskActor, id: string): Promise<TaskRecoveryDetail> {
    const row = await this.store.get(actor.userId, id);
    if (!row || !this.canRead(actor, row))
      throw Error("TASK_RECOVERY_NOT_FOUND");
    return redact({
      summary: this.summary(row),
      steps: row.checkpoint.steps,
      operations: row.checkpoint.operations,
      cwd: row.checkpoint.cwd,
      ai: row.checkpoint.ai?.view,
      workflowRuns: row.checkpoint.workflowState?.runs.map((r) => r.summary),
      activeWorkflowRunId: row.checkpoint.workflowState?.activeRunId,
    }) as TaskRecoveryDetail;
  }
  async save(actor: TaskActor, id: string) {
    let saved: TaskRecoveryRecord | undefined;
    const persist = async (
      c: import("../../../types/task-recovery.js").TaskExecutionCheckpoint,
    ) => {
      saved = await this.store.save(actor.userId, c);
    };
    if (
      this.tasks.get(actor, id, { operationLimit: 0 }).source === "assistant"
    ) {
      if (actor.kind !== "human" || !this.agents)
        throw Error("TASK_RECOVERY_AGENT_ADAPTER_REQUIRED");
      await this.agents.saveRecovery(actor.userId, id, persist);
    } else await this.tasks.saveRecovery(actor, id, persist);
    return this.summary(saved!);
  }
  async restore(
    actor: TaskActor,
    id: string,
    input: {
      sessionId: string;
      reviewed: boolean;
      reconciliation?: "retry" | "skip";
    },
  ) {
    if (!input.reviewed) throw Error("TASK_RECOVERY_REVIEW_REQUIRED");
    const before = await this.store.get(actor.userId, id);
    if (!before || !this.canRead(actor, before))
      throw Error("TASK_RECOVERY_NOT_FOUND");
    const record = await this.store.claim(actor.userId, id);
    let created: string | undefined, agent: RecoveredAgentTask | undefined;
    try {
      const checkpoint = readCheckpoint(record.checkpoint),
        request = {
          sessionId: input.sessionId,
          requestId: "recovery-" + record.claim!.id,
          reconciliation: input.reconciliation,
        };
      if (checkpoint.source === "assistant") {
        if (actor.kind !== "human" || !this.agents)
          throw Error("TASK_RECOVERY_AGENT_ADAPTER_REQUIRED");
        agent = await this.agents.prepareRecovery(
          actor.userId,
          checkpoint,
          request,
        );
      }
      const task =
        agent?.task ??
        (await this.tasks.restoreRecovery(actor, checkpoint, request));
      created = task.id;
      await this.store.save(
        actor.userId,
        this.tasks.recoverySnapshot(actor, task.id),
        true,
      );
      await this.store.transition(
        actor.userId,
        id,
        record.claim!.id,
        "consumed",
      );
      this.tasks.enableRecovery(actor, task.id);
      agent?.activate();
      return this.tasks.get(actor, task.id);
    } catch (error) {
      agent?.cancel();
      if (created) {
        try {
          this.tasks.cancel(actor, created);
        } catch {
          /* A revoked task cannot regain execution authority. */
        }
      }
      await this.store
        .transition(actor.userId, id, record.claim!.id, "available")
        .catch(() => {});
      throw error;
    }
  }
  async remove(actor: TaskActor, id: string) {
    const row = await this.store.get(actor.userId, id);
    if (!row || !this.canRead(actor, row))
      throw Error("TASK_RECOVERY_NOT_FOUND");
    await this.store.remove(actor.userId, id);
    return { removed: true };
  }
}
