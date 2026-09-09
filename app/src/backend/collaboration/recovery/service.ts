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
      id: row.id,
      title: c.title,
      hostId: c.host.id,
      hostName: c.host.name,
      source: c.source,
      mode: c.mode,
      nextStep: c.nextStep,
      stepCount: c.steps.length,
      reconciliationRequired: c.reconciliationRequired,
      resourceRecoveryRequired: c.resourceRecoveryRequired,
      state:
        row.state === "available" &&
        c.steps.length > 0 &&
        c.nextStep === c.steps.length &&
        !c.reconciliationRequired
          ? "consumed"
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
    }) as TaskRecoveryDetail;
  }
  async save(actor: TaskActor, id: string) {
    let saved: TaskRecoveryRecord | undefined;
    await this.tasks.saveRecovery(actor, id, async (c) => {
      saved = await this.store.save(actor.userId, c);
    });
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
    let created: string | undefined;
    try {
      const checkpoint = readCheckpoint(record.checkpoint),
        task = await this.tasks.restoreRecovery(actor, checkpoint, {
          sessionId: input.sessionId,
          requestId: "recovery-" + record.claim!.id,
          reconciliation: input.reconciliation,
        });
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
      return task;
    } catch (error) {
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
