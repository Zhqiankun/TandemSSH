import type { DirectoryRunView } from "../../../types/directory-transfer.js";
import { randomUUID } from "node:crypto";
import type { TaskActor, TaskRuntime } from "../tasks/runtime.js";
import type { DirectoryTransfers } from "../../files/directory-transfers.js";
import type {
  DirectoryAction,
  DirectoryChoice,
} from "../../../types/directory-transfer.js";
interface Run {
  actor: TaskActor;
  view: DirectoryRunView;
  token: object;
  releasePreview: () => void;
  entryOperations: Map<string, string>;
  confirm: Extract<DirectoryAction, { type: "file.directory.confirm" }>;
  actions?: Array<Extract<DirectoryAction, { type: "file.directory.entry" }>>;
  index: number;
  attempt: number;
  failures: boolean;
  stop: boolean;
  wake?: () => void;
}
const ended = (s: string) =>
  ["completed", "completed-with-errors", "cancelled"].includes(s);
export class DirectoryAutomation {
  private runs = new Map<string, Run>();
  private requests = new Map<string, { fingerprint: string; id: string }>();
  private disposed = false;
  constructor(
    private tasks: TaskRuntime,
    private directories: DirectoryTransfers,
  ) {}
  async preview(
    actor: TaskActor,
    taskId: string,
    input: Extract<DirectoryAction, { type: "file.directory.preview" }>,
    requestId: string,
  ) {
    this.tasks.fileContext(actor, taskId);
    const task = await this.tasks.submitFile(actor, taskId, input, requestId),
      op = task.operations.find((o) => o.requestId === requestId);
    if (!op) throw Error("OPERATION_NOT_FOUND");
    return { operationId: op.id, status: op.status };
  }
  previews(actor: TaskActor, taskId: string) {
    return this.directories.list(
      this.tasks.fileObservationContext(actor, taskId),
    );
  }
  page(actor: TaskActor, taskId: string, previewId: string, offset = 0) {
    const page = this.directories.page(
      this.tasks.fileObservationContext(actor, taskId),
      previewId,
      offset,
    );
    const run = [...this.runs.values()].find(
      (r) => r.view.previewId === previewId && r.view.taskId === taskId,
    );
    return {
      ...page,
      items: page.items.map((entry) => {
        const id = run?.entryOperations.get(entry.id) ?? entry.operationId;
        if (!id) return entry;
        const op = this.tasks.operation(actor, taskId, id);
        return {
          ...entry,
          operation: {
            id: op.id,
            status: op.status,
            error: op.error,
            auditGap: op.auditGap,
          },
        };
      }),
    };
  }
  run(
    actor: TaskActor,
    taskId: string,
    previewId: string,
    revision: string,
    choices: Array<{ id: string; action: DirectoryChoice }>,
    requestId: string,
  ) {
    const c = this.tasks.fileObservationContext(actor, taskId),
      key = JSON.stringify([
        actor.userId,
        actor.kind,
        actor.kind === "mcp"
          ? actor.clientId
          : actor.kind === "agent"
            ? actor.agentRunId
            : "human",
        taskId,
        requestId,
      ]);
    const fingerprint = JSON.stringify([
        previewId,
        revision,
        [...choices].sort((a, b) => a.id.localeCompare(b.id)),
      ]),
      prior = this.requests.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error("REQUEST_CONFLICT");
      return this.get(actor, taskId, prior.id);
    }
    if (
      this.disposed ||
      this.runs.size >= 128 ||
      this.requests.size >= 256 ||
      [...this.runs.values()].filter((r) => r.view.taskId === taskId).length >=
        32
    )
      throw Error("DIRECTORY_RUN_LIMIT");
    if ([...this.runs.values()].some((r) => r.view.previewId === previewId))
      throw Error("DIRECTORY_PREVIEW_USED");
    const confirm = this.directories.confirmation(c, previewId, choices);
    if (confirm.revision !== revision) throw Error("DIRECTORY_PREVIEW_CHANGED");
    const token = this.tasks.reserveDirectory(actor, taskId);
    let releasePreview: () => void;
    try {
      releasePreview = this.directories.retain(c, previewId);
    } catch (error) {
      this.tasks.releaseDirectory(taskId, token);
      throw error;
    }
    const r: Run = {
      actor: structuredClone(actor),
      token,
      releasePreview,
      entryOperations: new Map(),
      confirm,
      index: -1,
      attempt: 0,
      failures: false,
      stop: false,
      view: {
        id: randomUUID(),
        taskId,
        previewId,
        state: "running",
        completed: 0,
        total: choices.filter((c) => c.action !== "skip").length,
        createdAt: Date.now(),
      },
    };
    this.runs.set(r.view.id, r);
    this.requests.set(key, { fingerprint, id: r.view.id });
    void this.drive(r);
    return structuredClone(r.view);
  }
  private async wait(r: Run) {
    await new Promise<void>((resolve) => {
      let off = () => {};
      const wake = () => {
        clearTimeout(timer);
        off();
        r.wake = undefined;
        resolve();
      };
      const timer = setTimeout(wake, 250);
      off = this.tasks.observeTask(r.actor, r.view.taskId, wake);
      r.wake = wake;
      if (r.stop) wake();
    });
  }
  private async drive(r: Run) {
    try {
      while (!r.stop) {
        const state = this.tasks.state(r.actor, r.view.taskId, false);
        if (ended(state.state) || state.control.closed) {
          r.view.state = "cancelled";
          break;
        }
        if (r.view.operationId) {
          const op = this.tasks.operation(
            r.actor,
            r.view.taskId,
            r.view.operationId,
          );
          if (op.status === "succeeded" && !op.auditGap && !op.error) {
            if (r.index === -1) {
              r.actions = this.directories.actions(
                this.tasks.fileObservationContext(r.actor, r.view.taskId),
                r.view.previewId,
              );
              r.view.total = r.actions.length;
            } else r.view.completed++;
            r.index++;
            r.attempt = 0;
            r.view.operationId = undefined;
            r.view.error = undefined;
          } else if (
            ["failed", "unknown", "cancelled-before-send"].includes(
              op.status,
            ) ||
            op.auditGap ||
            op.error
          ) {
            const reviewed = this.tasks
              .get(r.actor, r.view.taskId)
              .operations.find((o) => o.id === op.id)?.reviewed;
            if (
              state.state === "ready" &&
              (reviewed?.decision === "retry" ||
                op.status === "cancelled-before-send")
            ) {
              r.attempt++;
              r.view.operationId = undefined;
              r.view.error = undefined;
            } else if (
              state.state === "ready" &&
              reviewed?.decision === "skip"
            ) {
              if (r.index === -1) {
                r.view.state = "cancelled";
                break;
              }
              r.failures = true;
              r.index++;
              r.view.completed++;
              r.view.operationId = undefined;
              r.attempt = 0;
            } else {
              r.view.state =
                state.state === "paused-human"
                  ? "paused-human"
                  : "paused-error";
              r.view.error =
                op.error ?? state.error ?? "DIRECTORY_ENTRY_FAILED";
              await this.wait(r);
              continue;
            }
          } else {
            r.view.state =
              op.status === "awaiting-approval"
                ? "awaiting-approval"
                : state.state === "paused-human"
                  ? "paused-human"
                  : "running";
            await this.wait(r);
            continue;
          }
        }
        if (r.actions && r.index >= r.actions.length) {
          r.view.state = r.failures ? "completed-with-errors" : "completed";
          break;
        }
        const current = this.tasks.state(r.actor, r.view.taskId, false);
        if (current.state !== "ready") {
          r.view.state =
            current.state === "paused-human"
              ? "paused-human"
              : current.state === "paused-error"
                ? "paused-error"
                : "running";
          r.view.error = current.error;
          await this.wait(r);
          continue;
        }
        const action = r.index < 0 ? r.confirm : r.actions![r.index];
        r.view.currentEntryId =
          action.type === "file.directory.entry" ? action.entryId : undefined;
        r.view.state = "running";
        const op = await this.tasks.submitDirectory(
          r.actor,
          r.view.taskId,
          action,
          `${r.view.id}:${r.index}:${r.attempt}`,
          r.token,
        );
        r.view.operationId = op.id;
        if (action.type === "file.directory.entry")
          r.entryOperations.set(action.entryId, op.id);
      }
    } catch (error) {
      r.view.state = "paused-error";
      r.view.error =
        error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "DIRECTORY_TRANSFER_FAILED";
    } finally {
      if (r.stop) r.view.state = "cancelled";
      r.view.endedAt = Date.now();
      r.wake?.();
      r.releasePreview();
      this.tasks.releaseDirectory(r.view.taskId, r.token);
    }
  }
  get(actor: TaskActor, taskId: string, runId: string) {
    this.tasks.fileObservationContext(actor, taskId);
    const r = this.runs.get(runId);
    if (!r || r.view.taskId !== taskId || r.actor.userId !== actor.userId)
      throw Error("DIRECTORY_RUN_NOT_FOUND");
    return structuredClone(r.view);
  }
  list(actor: TaskActor, taskId: string) {
    this.tasks.fileObservationContext(actor, taskId);
    return [...this.runs.values()]
      .filter(
        (r) => r.view.taskId === taskId && r.actor.userId === actor.userId,
      )
      .map((r) => structuredClone(r.view));
  }
  async release(actor: TaskActor, taskId: string, previewId: string) {
    const c = this.tasks.fileObservationContext(actor, taskId);
    if (
      [...this.runs.values()].some(
        (r) => r.view.previewId === previewId && !r.view.endedAt,
      )
    )
      throw Error("DIRECTORY_IN_PROGRESS");
    return this.directories.release(c, previewId);
  }
  dispose() {
    this.disposed = true;
    for (const r of this.runs.values()) {
      r.stop = true;
      r.wake?.();
    }
  }
}
