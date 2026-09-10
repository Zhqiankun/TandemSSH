import type { TaskRecoveryService } from "../collaboration/recovery/service.js";
import type { DirectoryAutomation } from "../collaboration/files/directories.js";
import type { TransferAutomation } from "../collaboration/files/transfers.js";
import type { FileAutomation } from "../collaboration/files/automation.js";
import {
  coreInputSchemas,
  parseCoreRequest,
  type CoreMethod,
} from "./contracts.js";
import type { BridgePrincipal } from "./bridge/server.js";
import type { TaskRuntime, TaskActor } from "../collaboration/tasks/runtime.js";
import type {
  TaskView,
  TaskOperation,
} from "../../types/collaboration-task.js";
import { redact } from "../privacy/redaction.js";
import type { WorkflowAutomationPort } from "../collaboration/workflows/library.js";
export interface McpCorePorts {
  recovery?: TaskRecoveryService;
  directories?: DirectoryAutomation;
  files?: FileAutomation;
  transfers?: TransferAutomation;
  workflows?: WorkflowAutomationPort;
  tasks: TaskRuntime;
  hosts(
    principal: BridgePrincipal,
  ): Promise<
    Array<{ id: number; name: string; address: string; port: number }>
  >;
  sessions(principal: BridgePrincipal): Array<{
    id: string;
    hostId: number;
    hostName: string;
    connected: boolean;
    control: unknown;
  }>;
  output(
    principal: BridgePrincipal,
    sessionId: string,
  ): {
    text: string;
    cursor: number;
    generation: number;
    firstCursor: number;
    truncated?: boolean;
    recordingFailure?:
      import("../../types/terminal-recording.js").RecordingFailure | null;
  };
  open(
    principal: BridgePrincipal,
    hostId: number,
    requestId: string,
  ): Promise<unknown>;
}
function actor(principal: BridgePrincipal): TaskActor {
  return {
    kind: "mcp",
    userId: principal.userId,
    clientId: principal.clientId,
    connectionId: principal.connectionId,
    allowedHostIds: [...principal.allowedHostIds],
  };
}
function operation(op: TaskOperation) {
  return {
    ...op,
    output: op.output?.slice(-12000),
    outputTruncated: (op.output?.length ?? 0) > 12000,
  };
}
function task(view: TaskView) {
  return {
    id: view.id,
    sessionId: view.sessionId,
    hostId: view.hostId,
    title: view.title,
    source: view.source,
    mode: view.mode,
    state: view.state,
    cwd: view.cwd,
    control: view.control,
    error: view.error,
    policyRevision: view.policyRevision,
    workflow: view.workflow,
    workflowRuns: view.workflowRuns,
    activeWorkflowRunId: view.activeWorkflowRunId,
    planRevision: view.planRevision,
    nextStep: view.nextStep,
    stepCount: view.stepCount,
    hasFailures: view.hasFailures,
    operationCount: view.operations.length,
    operations: view.operations.slice(-50).map((op) => ({
      id: op.id,
      requestId: op.requestId,
      program:
        op.action.type === "terminal.command" ? op.action.program : undefined,
      actionType: op.action.type,
      path: op.action.type === "terminal.command" ? undefined : op.action.path,
      fileResult: op.fileResult?.directory ? undefined : op.fileResult,
      directorySummary: op.fileResult?.directory
        ? {
            snapshotId: op.fileResult.directory.snapshotId,
            observedAt: op.fileResult.directory.observedAt,
            offset: op.fileResult.directory.offset,
            entryCount: op.fileResult.directory.entries.length,
            total: op.fileResult.directory.total,
            omitted: op.fileResult.directory.omitted,
            hasMore: !!op.fileResult.directory.nextCursor,
          }
        : undefined,
      status: op.status,
      error: op.error,
      exitCode: op.exitCode,
      auditGap: op.auditGap,
      workflowRunId: op.workflowRunId,
    })),
  };
}
/** Protocol adapter to the shared task service. Only explicit projections
 * leave this boundary; no credential rows or human authorization APIs do. */
export class McpCore {
  constructor(private readonly ports: McpCorePorts) {}
  async invoke(
    principal: BridgePrincipal,
    method: CoreMethod,
    parameters: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    parseCoreRequest(method, parameters);
    if (signal.aborted) throw new Error("CLIENT_DISCONNECTED");
    const result = await this.dispatch(principal, method, parameters, signal);
    return redact(result);
  }
  private async dispatch(
    principal: BridgePrincipal,
    method: CoreMethod,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const identity = actor(principal);
    switch (method) {
      case "recovery.list": {
        if (!this.ports.recovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
        return this.ports.recovery.list(identity);
      }
      case "recovery.detail": {
        if (!this.ports.recovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
        const p = coreInputSchemas[method].parse(input);
        return this.ports.recovery.detail(identity, p.id);
      }
      case "recovery.save": {
        if (!this.ports.recovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
        const p = coreInputSchemas[method].parse(input);
        return this.ports.recovery.save(identity, p.taskId);
      }
      case "recovery.restore": {
        if (!this.ports.recovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
        const p = coreInputSchemas[method].parse(input);
        return this.ports.recovery.restore(identity, p.id, {
          sessionId: p.sessionId,
          reviewed: true,
        });
      }

      case "transfers.local": {
        if (!this.ports.transfers)
          throw Error("FILE_TRANSFER_EXECUTOR_UNAVAILABLE");
        const p = coreInputSchemas[method].parse(input);
        return this.ports.transfers.list(identity, p.taskId);
      }
      case "transfers.upload":
      case "transfers.download": {
        if (!this.ports.transfers)
          throw Error("FILE_TRANSFER_EXECUTOR_UNAVAILABLE");
        const { taskId, requestId, ...value } =
          coreInputSchemas[method].parse(input);
        return this.ports.transfers.submit(
          identity,
          taskId,
          value,
          requestId,
          method === "transfers.upload" ? "upload" : "download",
        );
      }
      case "transfers.progress":
      case "transfers.release": {
        if (!this.ports.transfers)
          throw Error("FILE_TRANSFER_EXECUTOR_UNAVAILABLE");
        const p = coreInputSchemas[method].parse(input);
        return method === "transfers.progress"
          ? this.ports.transfers.progress(identity, p.taskId, p.operationId)
          : this.ports.transfers.release(identity, p.taskId, p.operationId);
      }
      case "files.list":
      case "files.stat": {
        if (!this.ports.files) throw Error("FILE_EXECUTOR_UNAVAILABLE");
        const { taskId, requestId, ...value } =
          coreInputSchemas[method].parse(input);
        return this.ports.files.inspect(
          identity,
          taskId,
          value,
          requestId,
          method === "files.list" ? "list" : "stat",
        );
      }
      case "files.read": {
        if (!this.ports.files) throw Error("FILE_EXECUTOR_UNAVAILABLE");
        const { taskId, requestId, ...value } =
          coreInputSchemas[method].parse(input);
        return this.ports.files.read(identity, taskId, value, requestId);
      }
      case "files.content": {
        if (!this.ports.files) throw Error("FILE_EXECUTOR_UNAVAILABLE");
        const { taskId, ...value } = coreInputSchemas[method].parse(input);
        return this.ports.files.content(identity, taskId, value);
      }
      case "files.edit": {
        if (!this.ports.files) throw Error("FILE_EXECUTOR_UNAVAILABLE");
        const { taskId, requestId, ...value } =
          coreInputSchemas[method].parse(input);
        return this.ports.files.change(
          identity,
          taskId,
          value,
          requestId,
          "edit",
        );
      }
      case "files.write": {
        if (!this.ports.files) throw Error("FILE_EXECUTOR_UNAVAILABLE");
        const { taskId, requestId, ...value } =
          coreInputSchemas[method].parse(input);
        return this.ports.files.change(
          identity,
          taskId,
          value,
          requestId,
          "write",
        );
      }
      case "directories.preview": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.directories) throw Error("FILE_DIRECTORY_UNAVAILABLE");
        const { taskId, requestId, ...data } = p;
        return this.ports.directories.preview(
          identity,
          taskId,
          { type: "file.directory.preview", ...data },
          requestId,
        );
      }
      case "directories.page": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.directories) throw Error("FILE_DIRECTORY_UNAVAILABLE");
        return this.ports.directories.page(
          identity,
          p.taskId,
          p.previewId,
          p.offset,
        );
      }
      case "directories.run": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.directories) throw Error("FILE_DIRECTORY_UNAVAILABLE");
        return this.ports.directories.run(
          identity,
          p.taskId,
          p.previewId,
          p.revision,
          p.choices,
          p.requestId,
        );
      }
      case "directories.state": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.directories) throw Error("FILE_DIRECTORY_UNAVAILABLE");
        return this.ports.directories.get(identity, p.taskId, p.runId);
      }
      case "directories.release": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.directories) throw Error("FILE_DIRECTORY_UNAVAILABLE");
        return this.ports.directories.release(identity, p.taskId, p.previewId);
      }
      case "workflows.list": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return this.ports.workflows.catalog(identity, p.hostId, p.offset);
      }
      case "workflows.get": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return this.ports.workflows.detail(identity, p.hostId, p.workflowId);
      }
      case "workflows.preview": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return {
          ...this.ports.workflows.preview(identity, p),
          contentTrust: "untrusted-workflow-preview",
        };
      }
      case "workflows.start": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return task(
          await this.ports.workflows.start(
            identity,
            p.previewId,
            p.requestId,
            p.mode,
          ),
        );
      }
      case "workflows.run": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return this.ports.workflows.run(
          identity,
          p.taskId,
          p.previewId,
          p.requestId,
        );
      }
      case "workflows.result": {
        const p = coreInputSchemas[method].parse(input);
        if (!this.ports.workflows) throw new Error("WORKFLOW_UNAVAILABLE");
        return this.ports.workflows.result(identity, p.taskId, p.workflowRunId);
      }
      case "status":
        return {
          connected: true,
          clientId: principal.clientId,
          connectionId: principal.connectionId,
          allowedHostIds: principal.allowedHostIds,
          readTerminal: principal.readTerminal,
          requiresDesktopAuthorization: true,
          capabilities: [
            "shared-terminal",
            "task-authorization",
            "cooperative-approval",
            "scoped-automatic",
            "human-takeover",
            ...(this.ports.directories && this.ports.transfers?.available()
              ? ["directory-previews", "per-entry-directory-transfers"]
              : []),
            ...(this.ports.transfers?.available()
              ? [
                  "authorized-local-files",
                  "binary-transfers",
                  "transfer-progress",
                ]
              : []),
            ...(this.ports.files
              ? ["scoped-file-read", "versioned-file-edit", "human-file-review"]
              : []),
            ...(this.ports.workflows
              ? ["saved-workflows", "parent-task-workflows"]
              : []),
          ],
        };
      case "hosts.list":
        return {
          hosts: (await this.ports.hosts(principal))
            .filter((host) => principal.allowedHostIds.includes(host.id))
            .map((host) => ({
              id: host.id,
              name: host.name,
              address: host.address,
              port: host.port,
            })),
        };
      case "sessions.list": {
        const p = coreInputSchemas[method].parse(input);
        return {
          sessions: this.ports
            .sessions(principal)
            .filter(
              (session) =>
                principal.allowedHostIds.includes(session.hostId) &&
                (!p.hostId || p.hostId === session.hostId),
            ),
        };
      }
      case "sessions.open": {
        const p = coreInputSchemas[method].parse(input);
        if (!principal.allowedHostIds.includes(p.hostId))
          throw new Error("HOST_NOT_FOUND");
        return this.ports.open(principal, p.hostId, p.requestId);
      }
      case "sessions.output": {
        const p = coreInputSchemas[method].parse(input);
        if (!principal.readTerminal)
          throw new Error("MCP_TERMINAL_READ_DENIED");
        const output = this.ports.output(principal, p.sessionId);
        if (p.cursor !== undefined && p.cursor > output.cursor)
          throw new Error("CONTEXT_GAP");
        const safe = redact(output.text) as string;
        return {
          sessionId: p.sessionId,
          generation: output.generation,
          cursor: output.cursor,
          replace: true,
          unchanged: p.cursor === output.cursor,
          contextGap:
            p.cursor !== undefined
              ? p.cursor < output.firstCursor
              : output.truncated === true,
          truncated: output.truncated === true || safe.length > p.maxCharacters,
          text: p.cursor === output.cursor ? "" : safe.slice(-p.maxCharacters),
          recordingFailure: output.recordingFailure ?? null,
          contentTrust: "untrusted-terminal-output",
        };
      }
      case "tasks.create": {
        const p = coreInputSchemas[method].parse(input);
        return task(
          await this.ports.tasks.create(identity, {
            sessionId: p.sessionId,
            requestId: p.requestId,
            title: p.goal,
            mode: p.mode,
          }),
        );
      }
      case "tasks.get": {
        const p = coreInputSchemas[method].parse(input);
        return task(this.ports.tasks.get(identity, p.taskId));
      }
      case "tasks.cancel": {
        const p = coreInputSchemas[method].parse(input);
        return task(this.ports.tasks.cancel(identity, p.taskId));
      }
      case "tasks.complete": {
        const p = coreInputSchemas[method].parse(input);
        return task(await this.ports.tasks.finish(identity, p.taskId));
      }
      case "commands.propose": {
        const p = coreInputSchemas[method].parse(input);
        const view = await this.ports.tasks.submit(
          identity,
          p.taskId,
          { program: p.program, args: p.args, cwd: p.cwd },
          p.requestId,
        );
        const op = view.operations.find(
          (item) => item.requestId === p.requestId,
        );
        if (!op) throw new Error("OPERATION_NOT_FOUND");
        return {
          taskId: view.id,
          taskState: this.ports.tasks.get(identity, view.id).state,
          operation: operation(op),
        };
      }
      case "operations.get": {
        const p = coreInputSchemas[method].parse(input);
        const op = this.ports.tasks
          .get(identity, p.taskId)
          .operations.find((op) => op.id === p.operationId);
        if (!op) throw new Error("OPERATION_NOT_FOUND");
        return operation(op);
      }
      case "operations.wait": {
        const p = coreInputSchemas[method].parse(input);
        const deadline = Date.now() + p.timeoutMs;
        let op: TaskOperation | undefined;
        do {
          if (signal.aborted) throw new Error("CLIENT_DISCONNECTED");
          op = this.ports.tasks
            .get(identity, p.taskId)
            .operations.find((op) => op.id === p.operationId);
          if (!op) throw new Error("OPERATION_NOT_FOUND");
          if (
            !["queued", "running", "proposed"].includes(op.status) ||
            Date.now() >= deadline
          )
            break;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, 100);
            function done() {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              resolve();
            }
            signal.addEventListener("abort", done, { once: true });
          });
        } while (Date.now() < deadline);
        return operation(op!);
      }
    }
  }
}
