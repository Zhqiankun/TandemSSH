import type { TaskRuntime, TaskActor } from "../tasks/runtime.js";
import type { LocalFileGrants } from "../../files/local-file-grants.js";
import type { AutomatedTransfers } from "../../files/automated-transfers.js";
import { transferRequestSchema } from "../../files/transfer-schema.js";
export class TransferAutomation {
  constructor(
    private tasks: TaskRuntime,
    private grants: LocalFileGrants,
    private transfers: AutomatedTransfers,
  ) {}
  available() {
    return this.grants.available();
  }
  list(actor: TaskActor, taskId: string) {
    const context = this.tasks.fileObservationContext(actor, taskId);
    return {
      files: this.grants.list(context.userId, taskId),
      contentTrust: "untrusted-local-file-names" as const,
    };
  }
  async submit(
    actor: TaskActor,
    taskId: string,
    input: unknown,
    requestId: string,
    direction: "upload" | "download",
  ) {
    this.tasks.fileObservationContext(actor, taskId);
    const data = transferRequestSchema.parse(input);
    if (!this.tasks.hasOperationRequest(actor, taskId, requestId))
      this.grants.assert(this.tasks.fileContext(actor, taskId), {
        ...data,
        type: direction === "upload" ? "file.upload" : "file.download",
      });
    const task = await this.tasks.submitFile(
      actor,
      taskId,
      {
        ...data,
        type: direction === "upload" ? "file.upload" : "file.download",
      },
      requestId,
    );
    const operation = task.operations.find((op) => op.requestId === requestId);
    if (!operation) throw Error("OPERATION_NOT_FOUND");
    return {
      operationId: operation.id,
      status: operation.status,
      action: operation.action,
    };
  }
  progress(actor: TaskActor, taskId: string, operationId: string) {
    const context = this.tasks.fileObservationContext(actor, taskId),
      op = this.tasks.operation(actor, taskId, operationId);
    if (op.action.type !== "file.upload" && op.action.type !== "file.download")
      throw Error("FILE_TRANSFER_NOT_FOUND");
    let progress: ReturnType<AutomatedTransfers["progress"]> | null = null;
    try {
      progress = this.transfers.progress(context, operationId);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "FILE_TRANSFER_NOT_FOUND")
        throw e;
    }
    return {
      operationId,
      status: op.status,
      error: op.error,
      auditGap: op.auditGap,
      fileResult: op.fileResult,
      progress: progress
        ? {
            phase: [
              "succeeded",
              "failed",
              "unknown",
              "cancelled-before-send",
            ].includes(op.status)
              ? op.status
              : progress.state,
            bytes: progress.bytes,
            totalBytes: progress.totalBytes,
          }
        : null,
    };
  }
  release(actor: TaskActor, taskId: string, operationId: string) {
    const context = this.tasks.fileObservationContext(actor, taskId),
      op = this.tasks.operation(actor, taskId, operationId);
    if (op.action.type !== "file.upload" && op.action.type !== "file.download")
      throw Error("FILE_TRANSFER_NOT_FOUND");
    if (
      !["succeeded", "failed", "cancelled-before-send"].includes(op.status) ||
      op.fileResult?.transfer?.cleanupRequired
    )
      throw Error("FILE_TRANSFER_CLEANUP_PENDING");
    try {
      this.transfers.forget(context, operationId);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "FILE_TRANSFER_NOT_FOUND")
        throw e;
    }
    return { operationId, released: true };
  }
}
