import { randomUUID } from "node:crypto";
import type { TaskActor, TaskRuntime } from "../tasks/runtime.js";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations.js";
import type { ControlSnapshot } from "../../../types/collaboration.js";
import type {
  SavedWorkflow,
  WorkflowDefinition,
  WorkflowPreview,
} from "../../../types/workflow.js";
import type {
  TaskMode,
  TaskView,
  TaskWorkflowRun,
} from "../../../types/collaboration-task.js";
import { parseWorkflow, compileWorkflow } from "./definition.js";
import { evaluateCommandPolicy } from "../policies/command-policy.js";
import { redact } from "../../privacy/redaction.js";
interface Target {
  hostId: number;
  groups: string[];
  control: ControlSnapshot;
}
export interface WorkflowLibraryPorts {
  read(userId: string): string | undefined;
  write(userId: string, value: string): Promise<void>;
  ownsHost(userId: string, hostId: number): Promise<boolean>;
  target(actor: TaskActor, sessionId: string): Target;
  policy(userId: string): CommandPolicySnapshot;
  audit(userId: string, type: string, data: unknown): Promise<void>;
  tasks: TaskRuntime;
}
interface PreviewRecord {
  view: WorkflowPreview;
  owner: string;
  groupIds: string[];
  control: ControlSnapshot;
  commands: ReturnType<typeof compileWorkflow>["commands"];
  start?: { requestId: string; mode: TaskMode; promise: Promise<TaskView> };
  run?: {
    taskId: string;
    requestId: string;
    promise: Promise<TaskWorkflowRun>;
  };
}
const actorKey = (actor: TaskActor) =>
  JSON.stringify([
    actor.userId,
    actor.kind,
    actor.kind === "mcp"
      ? [actor.clientId, actor.connectionId]
      : actor.kind === "agent"
        ? actor.agentRunId
        : "human",
  ]);
export class WorkflowLibrary {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly previews = new Map<string, PreviewRecord>();
  constructor(private readonly ports: WorkflowLibraryPorts) {}
  private read(userId: string): SavedWorkflow[] {
    const raw = this.ports.read(userId);
    if (!raw) return [];
    try {
      const rows = JSON.parse(raw) as SavedWorkflow[];
      if (!Array.isArray(rows) || rows.length > 128) throw Error();
      return rows.map((row) => {
        if (
          typeof row.id !== "string" ||
          !Number.isInteger(row.revision) ||
          row.revision < 1 ||
          !Array.isArray(row.allowedHostIds)
        )
          throw Error();
        return { ...row, definition: parseWorkflow(row.definition) };
      });
    } catch {
      throw new Error("WORKFLOW_STORE_INVALID");
    }
  }
  list(userId: string): SavedWorkflow[] {
    return structuredClone(this.read(userId));
  }
  get(userId: string, id: string): SavedWorkflow {
    const row = this.read(userId).find((row) => row.id === id);
    if (!row) throw new Error("WORKFLOW_NOT_FOUND");
    return structuredClone(row);
  }
  private serialize<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const pending = (this.mutations.get(userId) ?? Promise.resolve()).then(
      work,
    );
    this.mutations.set(
      userId,
      pending.catch(() => {}),
    );
    return pending;
  }
  save(
    userId: string,
    input: {
      id?: string;
      expectedRevision?: number;
      definition: unknown;
      allowedHostIds: number[];
    },
  ): Promise<SavedWorkflow> {
    return this.serialize(userId, async () => {
      const definition = parseWorkflow(input.definition),
        rows = this.read(userId);
      let old: SavedWorkflow | undefined;
      if (input.id) {
        old = rows.find((row) => row.id === input.id);
        if (!old) throw new Error("WORKFLOW_NOT_FOUND");
        if (input.expectedRevision !== old.revision)
          throw new Error("WORKFLOW_CHANGED");
      } else if (rows.length >= 128) throw new Error("WORKFLOW_LIMIT");
      const allowedHostIds = [...new Set(input.allowedHostIds)].sort(
        (a, b) => a - b,
      );
      for (const hostId of allowedHostIds)
        if (
          !Number.isInteger(hostId) ||
          hostId < 1 ||
          !(await this.ports.ownsHost(userId, hostId))
        )
          throw new Error("HOST_NOT_FOUND");
      const row = {
        id: old?.id ?? randomUUID(),
        revision: (old?.revision ?? 0) + 1,
        definition,
        allowedHostIds,
        updatedAt: Date.now(),
      };
      const next = JSON.stringify([
        ...rows.filter((item) => item.id !== row.id),
        row,
      ]);
      if (Buffer.byteLength(next) > 4 * 1024 * 1024)
        throw new Error("WORKFLOW_STORE_LIMIT");
      await this.ports.audit(userId, "workflow.save-requested", {
        id: row.id,
        revision: row.revision,
        name: definition.name,
      });
      await this.ports.write(userId, next);
      return structuredClone(row);
    });
  }
  remove(userId: string, id: string, expectedRevision: number): Promise<void> {
    return this.serialize(userId, async () => {
      const row = this.get(userId, id);
      if (row.revision !== expectedRevision)
        throw new Error("WORKFLOW_CHANGED");
      await this.ports.audit(userId, "workflow.remove-requested", {
        id,
        expectedRevision,
      });
      await this.ports.write(
        userId,
        JSON.stringify(this.read(userId).filter((item) => item.id !== id)),
      );
    });
  }
  inspectImport(value: unknown) {
    const definition = parseWorkflow(value);
    return { definition, warnings: this.exportWarnings(definition) };
  }
  export(userId: string, id: string) {
    const definition = this.get(userId, id).definition;
    return { definition, warnings: this.exportWarnings(definition) };
  }
  private exportWarnings(definition: WorkflowDefinition) {
    const warnings = ["CHECK_LITERAL_SECRETS"];
    if (JSON.stringify(redact(definition)) !== JSON.stringify(definition))
      warnings.push("RECOGNIZED_SECRET_PATTERN");
    return warnings;
  }
  preview(
    actor: TaskActor,
    input: {
      workflowId: string;
      sessionId: string;
      parameters: Record<string, unknown>;
      parentTaskId?: string;
    },
  ): WorkflowPreview & {
    decisions: ReturnType<typeof evaluateCommandPolicy>[];
  } {
    const stored = this.get(actor.userId, input.workflowId);
    const target = this.target(actor, input.sessionId);
    if (
      stored.allowedHostIds.length &&
      !stored.allowedHostIds.includes(target.hostId)
    )
      throw new Error("WORKFLOW_HOST_NOT_ALLOWED");
    if (
      input.parentTaskId &&
      this.ports.tasks.state(actor, input.parentTaskId).sessionId !==
        input.sessionId
    )
      throw new Error("WORKFLOW_PARENT_MISMATCH");
    const compiled = compileWorkflow(stored.definition, input.parameters),
      policy = this.ports.policy(actor.userId);
    for (const [id, record] of this.previews)
      if (!record.start && !record.run && record.view.expiresAt < Date.now())
        this.previews.delete(id);
    if (this.previews.size >= 256) throw new Error("WORKFLOW_PREVIEW_LIMIT");
    const view: WorkflowPreview = {
      id: randomUUID(),
      workflowId: stored.id,
      revision: stored.revision,
      definitionVersion: stored.definition.version,
      sessionId: input.sessionId,
      hostId: target.hostId,
      policyRevision: policy.revision,
      parentTaskId: input.parentTaskId,
      commands: compiled.commands,
      warnings: compiled.warnings,
      expiresAt: Date.now() + 5 * 60_000,
    };
    const decisions = compiled.commands.map((command) =>
      evaluateCommandPolicy(
        policy,
        {
          hostId: String(target.hostId),
          groupIds: target.groups,
          taskId: input.parentTaskId ?? "workflow-preview",
        },
        {
          type: "terminal.command",
          program: command.program,
          args: command.args,
          cwd: command.cwd ?? "/",
          timeoutMs: command.timeoutMs,
        },
      ),
    );
    this.previews.set(view.id, {
      view: structuredClone(view),
      owner: actorKey(actor),
      groupIds: [...target.groups].sort(),
      control: target.control,
      commands: structuredClone(compiled.commands),
    });
    return { ...structuredClone(view), decisions };
  }
  start(
    actor: TaskActor,
    previewId: string,
    requestId: string,
    mode: TaskMode,
  ): Promise<TaskView> {
    const record = this.previews.get(previewId);
    if (!record || record.owner !== actorKey(actor))
      return Promise.reject(new Error("WORKFLOW_PREVIEW_NOT_FOUND"));
    if (record.run || record.view.parentTaskId)
      return Promise.reject(new Error("WORKFLOW_PARENT_MISMATCH"));
    if (record.start) {
      if (record.start.requestId !== requestId || record.start.mode !== mode)
        return Promise.reject(new Error("WORKFLOW_PREVIEW_USED"));
      return record.start.promise.then((task) =>
        this.ports.tasks.get(actor, task.id),
      );
    }
    if (record.view.expiresAt < Date.now())
      return Promise.reject(new Error("WORKFLOW_PREVIEW_EXPIRED"));
    const stored = this.get(actor.userId, record.view.workflowId),
      target = this.target(actor, record.view.sessionId);
    if (stored.revision !== record.view.revision)
      throw new Error("WORKFLOW_CHANGED");
    if (this.ports.policy(actor.userId).revision !== record.view.policyRevision)
      throw new Error("POLICY_CHANGED");
    if (target.hostId !== record.view.hostId)
      throw new Error("HOST_CONFIGURATION_CHANGED");
    if (
      target.control.generation !== record.control.generation ||
      target.control.controlEpoch !== record.control.controlEpoch
    )
      throw new Error("STALE_CONTROL");
    this.preflight(record, target, actor, "workflow-preview");
    const promise = this.ports.tasks.create(actor, {
      sessionId: record.view.sessionId,
      requestId,
      title: stored.definition.name,
      mode,
      commands: structuredClone(record.commands),
      source: "workflow",
      workflow: {
        id: stored.id,
        revision: stored.revision,
        version: stored.definition.version,
        shellState: stored.definition.shellState ?? "explicit-cwd",
      },
    });
    record.start = { requestId, mode, promise };
    return promise;
  }
  private target(actor: TaskActor, sessionId: string): Target {
    const target = this.ports.target(actor, sessionId);
    if (actor.kind === "mcp" && !actor.allowedHostIds.includes(target.hostId))
      throw new Error("SESSION_NOT_FOUND");
    return target;
  }
  private preflight(
    record: PreviewRecord,
    target: Target,
    actor: TaskActor,
    taskId: string,
  ) {
    if (
      JSON.stringify([...target.groups].sort()) !==
      JSON.stringify(record.groupIds)
    )
      throw new Error("HOST_SCOPE_CHANGED");
    const policy = this.ports.policy(actor.userId);
    if (
      record.commands.some(
        (command) =>
          evaluateCommandPolicy(
            policy,
            { hostId: String(target.hostId), groupIds: target.groups, taskId },
            {
              type: "terminal.command",
              program: command.program,
              args: command.args,
              cwd: command.cwd ?? "/",
              timeoutMs: command.timeoutMs,
            },
          ).outcome === "deny",
      )
    )
      throw new Error("POLICY_DENIED");
  }
  private async allowedHost(actor: TaskActor, hostId: number) {
    if (
      (actor.kind === "mcp" && !actor.allowedHostIds.includes(hostId)) ||
      !(await this.ports.ownsHost(actor.userId, hostId))
    )
      throw new Error("HOST_NOT_FOUND");
  }
  async catalog(actor: TaskActor, hostId: number, offset = 0, limit = 20) {
    await this.allowedHost(actor, hostId);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new Error("INVALID_REQUEST");
    const rows = this.read(actor.userId)
      .filter(
        (row) =>
          !row.allowedHostIds.length || row.allowedHostIds.includes(hostId),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      hostId,
      workflows: rows.slice(offset, offset + limit).map((row) => ({
        id: row.id,
        revision: row.revision,
        name: row.definition.name,
        version: row.definition.version,
        category: row.definition.category,
        description: row.definition.description?.slice(0, 500),
        descriptionTruncated: (row.definition.description?.length ?? 0) > 500,
        stepCount: row.definition.steps.length,
      })),
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      contentTrust: "untrusted-workflow-metadata",
    };
  }
  async detail(actor: TaskActor, hostId: number, workflowId: string) {
    await this.allowedHost(actor, hostId);
    const row = this.get(actor.userId, workflowId);
    if (row.allowedHostIds.length && !row.allowedHostIds.includes(hostId))
      throw new Error("WORKFLOW_HOST_NOT_ALLOWED");
    return {
      id: row.id,
      revision: row.revision,
      name: row.definition.name,
      version: row.definition.version,
      description: row.definition.description,
      category: row.definition.category,
      shellState: row.definition.shellState ?? "explicit-cwd",
      parameters: row.definition.parameters,
      steps: row.definition.steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: step.action.type,
        program:
          step.action.type === "command"
            ? step.action.program
            : step.action.shell,
      })),
      requiresPreview: true,
      secretTransportSupported: false,
      contentTrust: "untrusted-workflow-definition",
    };
  }
  run(
    actor: TaskActor,
    taskId: string,
    previewId: string,
    requestId: string,
  ): Promise<TaskWorkflowRun> {
    const record = this.previews.get(previewId);
    if (!record || record.owner !== actorKey(actor))
      return Promise.reject(new Error("WORKFLOW_PREVIEW_NOT_FOUND"));
    if (record.start || record.view.parentTaskId !== taskId)
      return Promise.reject(new Error("WORKFLOW_PARENT_MISMATCH"));
    if (record.run) {
      if (record.run.taskId !== taskId || record.run.requestId !== requestId)
        return Promise.reject(new Error("WORKFLOW_PREVIEW_USED"));
      return record.run.promise.then((run) =>
        this.ports.tasks.workflowRunSummary(actor, taskId, run.id),
      );
    }
    if (record.view.expiresAt < Date.now())
      return Promise.reject(new Error("WORKFLOW_PREVIEW_EXPIRED"));
    const row = this.get(actor.userId, record.view.workflowId),
      target = this.target(actor, record.view.sessionId);
    if (row.revision !== record.view.revision)
      throw new Error("WORKFLOW_CHANGED");
    if (this.ports.policy(actor.userId).revision !== record.view.policyRevision)
      throw new Error("POLICY_CHANGED");
    if (target.hostId !== record.view.hostId)
      throw new Error("HOST_CONFIGURATION_CHANGED");
    if (
      this.ports.tasks.state(actor, taskId).sessionId !== record.view.sessionId
    )
      throw new Error("WORKFLOW_PARENT_MISMATCH");
    this.preflight(record, target, actor, taskId);
    const promise = this.ports.tasks.attachWorkflow(actor, taskId, {
      requestId,
      name: row.definition.name,
      workflow: {
        id: row.id,
        revision: row.revision,
        version: row.definition.version,
        shellState: row.definition.shellState ?? "explicit-cwd",
      },
      commands: structuredClone(record.commands),
      expectedControl: record.control,
      expectedGroupIds: record.groupIds,
    });
    record.run = { taskId, requestId, promise };
    return promise;
  }
  result(actor: TaskActor, taskId: string, runId: string) {
    const run = this.ports.tasks.workflowRunSummary(actor, taskId, runId);
    let remaining = 12000;
    const operations = run.operationIds
      .map((id) => this.ports.tasks.operation(actor, taskId, id))
      .reverse()
      .map((op) => {
        const limit = Math.min(4000, remaining);
        const output = limit ? op.output?.slice(-limit) : undefined;
        remaining -= output?.length ?? 0;
        return {
          id: op.id,
          program:
            op.action.type === "terminal.command"
              ? op.action.program
              : undefined,
          actionType: op.action.type,
          path:
            op.action.type === "terminal.command" ? undefined : op.action.path,
          fileResult: op.fileResult,
          status: op.status,
          exitCode: op.exitCode,
          cwd: op.resultingCwd,
          error: op.error,
          auditGap: op.auditGap,
          reviewed: op.reviewed,
          output: remaining < 0 ? undefined : output,
          outputTruncated: (op.output?.length ?? 0) > (output?.length ?? 0),
          startedAt: op.startedAt,
          endedAt: op.endedAt,
        };
      })
      .reverse();
    return { ...run, operations, contentTrust: "untrusted-command-output" };
  }
}

export type WorkflowAutomationPort = Pick<
  WorkflowLibrary,
  "catalog" | "detail" | "preview" | "start" | "run" | "result"
>;
