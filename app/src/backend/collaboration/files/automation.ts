import type { TaskRuntime, TaskActor } from "../tasks/runtime.js";
import type { AutomatedDocuments } from "../../files/automated-documents.js";
import {
  fileReadSchema,
  fileListSchema,
  fileStatSchema,
  fileContentSchema,
  fileEditSchema,
  fileWriteSchema,
} from "../../files/automation-schema.js";
export class FileAutomation {
  constructor(
    private readonly tasks: TaskRuntime,
    private readonly documents: AutomatedDocuments,
  ) {}
  async read(
    actor: TaskActor,
    taskId: string,
    input: unknown,
    requestId: string,
  ) {
    this.tasks.fileContext(actor, taskId);
    const value = fileReadSchema.parse(input);
    const task = await this.tasks.submitFile(
      actor,
      taskId,
      { type: "file.read", ...value },
      requestId,
    );
    const op = task.operations.find((op) => op.requestId === requestId);
    if (!op) throw Error("OPERATION_NOT_FOUND");
    return { operationId: op.id, status: op.status, action: op.action };
  }
  async inspect(
    actor: TaskActor,
    taskId: string,
    input: unknown,
    requestId: string,
    kind: "list" | "stat",
  ) {
    this.tasks.fileContext(actor, taskId);
    const action =
      kind === "list"
        ? { type: "file.list" as const, ...fileListSchema.parse(input) }
        : { type: "file.stat" as const, ...fileStatSchema.parse(input) };
    const task = await this.tasks.submitFile(actor, taskId, action, requestId);
    const op = task.operations.find((op) => op.requestId === requestId);
    if (!op) throw Error("OPERATION_NOT_FOUND");
    return { operationId: op.id, status: op.status, action: op.action };
  }
  content(actor: TaskActor, taskId: string, input: unknown) {
    const p = fileContentSchema.parse(input);
    return this.documents.content(
      this.tasks.fileContext(actor, taskId),
      p.version,
      p.offset,
      p.maxCharacters,
    );
  }
  async change(
    actor: TaskActor,
    taskId: string,
    input: unknown,
    requestId: string,
    kind: "edit" | "write",
  ) {
    const value = (kind === "edit" ? fileEditSchema : fileWriteSchema).parse(
        input,
      ),
      context = this.tasks.fileContext(actor, taskId);
    const action = this.documents.propose(context, value, requestId);
    const task = await this.tasks.submitFile(actor, taskId, action, requestId);
    const op = task.operations.find((op) => op.requestId === requestId);
    if (!op) throw Error("OPERATION_NOT_FOUND");
    return { operationId: op.id, status: op.status, action: op.action };
  }
  review(actor: TaskActor, taskId: string, operationId: string) {
    if (actor.kind !== "human") throw Error("HUMAN_APPROVAL_REQUIRED");
    const context = this.tasks.fileContext(actor, taskId),
      op = this.tasks.operation(actor, taskId, operationId);
    if (op.action.type !== "file.write") throw Error("FILE_REVIEW_UNAVAILABLE");
    return this.documents.review(
      actor.userId,
      taskId,
      operationId,
      op.action,
      op.digest,
      op.decision.revision,
      context.control,
    );
  }
}
