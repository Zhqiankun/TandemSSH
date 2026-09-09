import type { DirectoryStepCheckpoint } from "../../../types/directory-step-recovery.js";
import type {
  DirectoryStepCursor,
  DirectoryStepPort,
} from "../tasks/directory-plan-port.js";
import type {
  TaskFileStep,
  TaskFileBindings,
} from "../../../types/task-plan.js";
import type {
  DirectoryAction,
  DirectoryChoice,
} from "../../../types/directory-transfer.js";
import type { OperationView } from "../operations/gateway.js";
import type { LocalFileGrants } from "../../files/local-file-grants.js";
import type { DirectoryTransfers } from "../../files/directory-transfers.js";
import type { FileTaskContext } from "../../files/automated-documents.js";
import { directoryStepAction } from "../tasks/plan.js";
/** Produces actions only. The parent task owns dispatch, approvals and lease changes. */
export class DirectoryWorkflowSteps implements DirectoryStepPort {
  constructor(
    private grants: LocalFileGrants,
    private directories: DirectoryTransfers,
    private context: (userId: string, taskId: string) => FileTaskContext,
  ) {}
  validate(
    userId: string,
    taskId: string,
    step: TaskFileStep,
    bindings: TaskFileBindings,
  ) {
    this.grants.assertDirectory(
      this.context(userId, taskId),
      directoryStepAction(step, bindings),
    );
  }
  open(
    userId: string,
    taskId: string,
    step: TaskFileStep,
    bindings: TaskFileBindings,
    recovery?: DirectoryStepCheckpoint,
  ): DirectoryStepCursor {
    this.validate(userId, taskId, step, bindings);
    const preview = directoryStepAction(step, bindings),
      source = structuredClone(step),
      context = () => this.context(userId, taskId),
      directories = this.directories;
    let phase: "preview" | "confirm" | "entries" | "done" = "preview",
      previewId: string | undefined,
      entries: Array<
        Extract<DirectoryAction, { type: "file.directory.entry" }>
      > = [],
      index = 0,
      closed = false,
      unlock: (() => void) | undefined;
    const releaseRecovery = recovery
      ? directories.prepareRecovery(context(), preview, recovery)
      : undefined;
    const accepted = new Set<string>();
    const next = (): DirectoryAction | undefined => {
      if (closed) throw Error("WORKFLOW_DIRECTORY_CLOSED");
      if (phase === "done") return undefined;
      if (phase === "preview") return structuredClone(preview);
      if (phase === "entries") return structuredClone(entries[index]);
      const choices: Array<{ id: string; action: DirectoryChoice }> = [];
      const recoveredChoices = directories.recoveryChoices(
        context(),
        previewId!,
      );
      for (let offset = 0; ;) {
        const page = directories.page(context(), previewId!, offset);
        for (const e of page.items) {
          const action: DirectoryChoice =
            recoveredChoices?.find((c) => c.id === e.id)?.action ??
            (e.kind === "excluded" || e.status === "blocked"
              ? "skip"
              : e.status === "new"
                ? "create"
                : e.status === "directory"
                  ? "merge"
                  : source.onConflict === "overwrite"
                    ? "overwrite"
                    : "skip");
          choices.push({ id: e.id, action });
        }
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      return {
        ...directories.confirmation(context(), previewId!, choices),
        requireAllAllowed: true,
        stopOnConflict: (source.onConflict ?? "fail") === "fail",
      };
    };
    return {
      async prepareCheckpoint(guard) {
        if (!closed && phase === "entries")
          await directories.prepareCheckpoint(
            context(),
            previewId!,
            step.stepId,
            guard,
          );
      },
      checkpoint() {
        return phase === "done"
          ? undefined
          : phase === "entries"
            ? directories.checkpoint(context(), previewId!, step.stepId)
            : recovery;
      },
      get done() {
        return phase === "done";
      },
      get requestIndex() {
        return accepted.size;
      },
      get canRestart() {
        return phase === "preview" || phase === "confirm";
      },
      get previewId() {
        return previewId;
      },
      matchesBinding(binding) {
        return (
          binding?.localGrantId === preview.localGrantId &&
          binding.localVersion === preview.localVersion
        );
      },
      next,
      accept(op: OperationView) {
        if (accepted.has(op.id)) return;
        const action = next(),
          result = op.fileResult?.directoryTransfer;
        if (
          op.context.taskId !== taskId ||
          op.status !== "succeeded" ||
          op.error ||
          op.auditGap ||
          !action ||
          !result ||
          op.action.type !== action.type
        )
          throw Error("WORKFLOW_DIRECTORY_RESULT_INVALID");
        if (action.type === "file.directory.preview") {
          const view = directories.summary(context(), result.previewId);
          if (
            result.phase !== "preview" ||
            view.localGrantId !== preview.localGrantId ||
            view.localVersion !== preview.localVersion ||
            view.path !== preview.path ||
            view.direction !== preview.direction
          )
            throw Error("WORKFLOW_DIRECTORY_RESULT_INVALID");
          previewId = result.previewId;
          unlock = directories.retain(context(), previewId);
          phase = "confirm";
          releaseRecovery?.();
        } else if (action.type === "file.directory.confirm") {
          if (
            result.phase !== "confirmed" ||
            result.previewId !== previewId ||
            result.revision !== action.revision
          )
            throw Error("WORKFLOW_DIRECTORY_RESULT_INVALID");
          entries = directories.actions(context(), previewId!);
          phase = entries.length ? "entries" : "done";
        } else {
          if (
            result.phase !== "entry" ||
            result.previewId !== previewId ||
            result.entryId !== action.entryId ||
            result.revision !== action.revision
          )
            throw Error("WORKFLOW_DIRECTORY_RESULT_INVALID");
          index++;
          if (index === entries.length) phase = "done";
        }
        accepted.add(op.id);
      },
      close() {
        if (closed) return;
        closed = true;
        releaseRecovery?.();
        unlock?.();
        unlock = undefined;
      },
    };
  }
}
