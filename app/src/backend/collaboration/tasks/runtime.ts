import type { DirectoryStepCheckpoint } from "../../../types/directory-step-recovery.js";
import type { AiExecutionCheckpoint } from "../../../types/ai-task-recovery.js";
import type { TaskExecutionCheckpoint } from "../../../types/task-recovery.js";
import type {
  DirectoryStepCursor,
  DirectoryStepPort,
} from "./directory-plan-port.js";
import {
  isTaskFileStep,
  type TaskFileStep,
  type TaskPlanStep,
  type TaskFileBindings,
} from "../../../types/task-plan.js";
import {
  validateTaskPlan,
  fileStepAction,
  fileBindingsSchema,
  canContinueStepFailure,
} from "./plan.js";
import type { FileTransferAction } from "../../../types/file-transfer.js";
import type { FileAction } from "../../../types/file-operations.js";
import {
  validateFileAction,
  fileScopeSchema,
} from "../policies/file-policy.js";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { ControlLease } from "../../../types/collaboration.js";
import type {
  OperationAction,
  CommandPolicySnapshot,
} from "../../../types/collaboration-operations.js";
import type {
  TaskAuthorization,
  TaskWorkflowRun,
  WorkflowReference,
  TaskCommand,
  TaskMode,
  TaskView,
  TaskViewOptions,
  TaskOperation,
} from "../../../types/collaboration-task.js";
import { redact } from "../../privacy/redaction.js";
import {
  OperationGateway,
  type OperationView,
  type OperationAuditPort,
  type PreparedCommand,
  type CommandExecutorPort,
  type FileExecutorPort,
} from "../operations/gateway.js";
import { SessionControl } from "../sessions/control.js";
import { validateCommandAction } from "../policies/command-policy.js";

export type TaskActor =
  | { kind: "human"; userId: string }
  | { kind: "agent"; userId: string; agentRunId: string }
  | {
      kind: "mcp";
      userId: string;
      clientId: string;
      connectionId: string;
      allowedHostIds: number[];
    };
export interface TaskSession {
  acceptedHostKey?: string;
  assertAvailable?: () => void;
  files?: FileExecutorPort;
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  groups: () => string[];
  control: SessionControl;
  executor: CommandExecutorPort & { prepareContext(): PreparedCommand };
}
export interface TaskRuntimePorts {
  persistRecovery?(
    checkpoint: TaskExecutionCheckpoint,
    finished?: boolean,
  ): Promise<void>;
  directorySteps?: DirectoryStepPort;
  validateFileBinding?(
    userId: string,
    taskId: string,
    action: FileTransferAction,
  ): void;
  releaseTransferProgress?(
    userId: string,
    taskId: string,
    operationId: string,
  ): void;
  fileReviewValid?(
    userId: string,
    taskId: string,
    operationId: string,
    proposalId: string,
    digest: string,
    revision: number,
    control: { generation: number; controlEpoch: number },
    receipt?: string,
  ): boolean;
  notifyTask?(sessionId: string, taskId: string): void;
  getSession(id: string): TaskSession | null;
  policy(userId: string): Promise<CommandPolicySnapshot>;
  audit(userId: string): OperationAuditPort & {
    record(type: string, data: unknown): Promise<void>;
  };
}
interface TaskWorkflowRecord {
  summary: TaskWorkflowRun;
  commands: TaskCommand[];
  plan?: TaskPlanStep[];
  fileBindings?: TaskFileBindings;
}
export interface AttachWorkflow {
  plan?: TaskPlanStep[];
  fileBindings?: TaskFileBindings;
  expectedGroupIds?: string[];
  requestId: string;
  name: string;
  workflow: WorkflowReference;
  commands: TaskCommand[];
  expectedControl: { generation: number; controlEpoch: number };
}
type RuntimeStep = TaskPlanStep & {
  operationId?: string;
  directoryCursor?: DirectoryStepCursor;
  directoryRecovery?: DirectoryStepCheckpoint;
};
interface RecordTask {
  recoveryAgent?: () => AiExecutionCheckpoint;
  recoveryEnabled?: boolean;
  recoverySaving?: boolean;
  recoveryRestoring?: boolean;
  recoveryHistory?: TaskOperation[];
  recoveryDecisionRequired?: boolean;
  unsubscribe?: () => void;
  archiving?: boolean;
  view: Omit<TaskView, "control" | "operations" | "policyRevision">;
  initialPlan: { steps: TaskPlanStep[]; workflow?: TaskView["workflow"] };
  workflowRuns: Map<string, TaskWorkflowRecord>;
  workflowRequests: Map<
    string,
    { fingerprint: string; promise: Promise<TaskWorkflowRun> }
  >;
  attachingWorkflow?: boolean;
  activeWorkflowRunId?: string;
  reviewedPlanId?: string;
  continuedFailures: Set<string>;
  userId: string;
  agentRunId?: string;
  clientId?: string;
  connectionId?: string;
  session: TaskSession;
  gateway: OperationGateway;
  policy: CommandPolicySnapshot;
  lease?: ControlLease;
  scope?: TaskAuthorization;
  authorizedGroups?: string[];
  deadline?: number;
  workflowCwd?: string;
  operationIds: string[];
  operationRequests: Map<string, string>;
  operationWorkflows: Map<string, string>;
  pendingOperations: Set<string>;
  steps: RuntimeStep[];
  fileBindings: TaskFileBindings;
  generation: number;
  pumping?: number;
  attempts: Set<string>;
  probe?: PreparedCommand;
  submitting?: boolean;
  listeners: Set<() => void>;
  progressListeners: Set<() => void>;
  directoryReservation?: object;
  reviews: Map<string, { decision: "skip" | "retry"; at: number }>;
}
const terminalState = (state: string) =>
  ["completed", "completed-with-errors", "cancelled"].includes(state);
const inactive = (state: string) =>
  terminalState(state) ||
  state.startsWith("paused") ||
  state === "awaiting-authorization";

export class TaskRuntime {
  private readonly tasks = new Map<string, RecordTask>();
  private readonly archived = new Map<
    string,
    { userId: string; hostId: number; clientId?: string; agentRunId?: string }
  >();
  private readonly requests = new Map<string, string>();
  private readonly pendingCreates = new Map<
    string,
    { fingerprint: string; promise: Promise<TaskView> }
  >();
  private readonly authorizing = new Set<string>();
  private readonly clients = new Set<string>();
  constructor(private readonly ports: TaskRuntimePorts) {}

  connectClient(connectionId: string): void {
    this.clients.add(connectionId);
  }
  disconnectClient(connectionId: string): void {
    this.clients.delete(connectionId);
    for (const task of this.tasks.values())
      if (
        task.connectionId === connectionId &&
        !terminalState(task.view.state)
      ) {
        task.generation++;
        task.view.state = "cancelled";
        this.closeDirectorySteps(task);
        task.view.error ??= "CLIENT_DISCONNECTED";
        this.recordCancellation(task, "CLIENT_DISCONNECTED");
        task.probe?.dispose();
        this.returnControl(task);
      }
  }
  private sessionFor(actor: TaskActor, id: string): TaskSession {
    const session = this.ports.getSession(id);
    if (
      !session ||
      session.userId !== actor.userId ||
      (actor.kind === "mcp" && !actor.allowedHostIds.includes(session.hostId))
    )
      throw new Error("SESSION_NOT_FOUND");
    return session;
  }
  private owned(actor: TaskActor, id: string): RecordTask {
    const task = this.tasks.get(id);
    const archived = this.archived.get(id);
    if (
      !task &&
      archived?.userId === actor.userId &&
      (actor.kind === "human" ||
        (actor.kind === "mcp" &&
          archived.clientId === actor.clientId &&
          actor.allowedHostIds.includes(archived.hostId)) ||
        (actor.kind === "agent" && archived.agentRunId === actor.agentRunId))
    )
      throw Error("TASK_ARCHIVED");
    if (
      !task ||
      task.userId !== actor.userId ||
      (actor.kind === "agent" && task.agentRunId !== actor.agentRunId) ||
      (actor.kind === "mcp" &&
        (task.clientId !== actor.clientId ||
          !actor.allowedHostIds.includes(task.view.hostId)))
    )
      throw new Error("TASK_NOT_FOUND");
    return task;
  }
  private human(actor: TaskActor): void {
    if (actor.kind !== "human") throw new Error("HUMAN_APPROVAL_REQUIRED");
  }

  create(
    actor: TaskActor,
    input: Parameters<TaskRuntime["createTask"]>[1],
  ): Promise<TaskView> {
    const frozen = structuredClone(input);
    if (
      !frozen.requestId ||
      frozen.requestId.length > 128 ||
      !frozen.title ||
      frozen.title.length > 8000 ||
      !["collaborative", "automatic"].includes(frozen.mode) ||
      (frozen.commands?.length ?? 0) > 100
    )
      return Promise.reject(new Error("INVALID_REQUEST"));
    validateTaskPlan(frozen.plan ?? frozen.commands ?? []);
    const key = JSON.stringify([
      actor.userId,
      actor.kind === "mcp"
        ? actor.clientId
        : actor.kind === "agent"
          ? "agent:" + actor.agentRunId
          : "human",
      frozen.requestId,
    ]);
    const fingerprint = JSON.stringify([
      frozen.sessionId,
      frozen.title,
      frozen.mode,
      frozen.plan ?? frozen.commands ?? [],
      frozen.source ?? "workflow",
      frozen.workflow ?? null,
    ]);
    const pending = this.pendingCreates.get(key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? pending.promise
        : Promise.reject(new Error("REQUEST_CONFLICT"));
    if (
      !this.requests.has(key) &&
      this.tasks.size + this.pendingCreates.size >= 128
    )
      return Promise.reject(new Error("TASK_CAPACITY_REACHED"));
    const promise = Promise.resolve()
      .then(() => this.createTask(actor, frozen))
      .finally(() => this.pendingCreates.delete(key));
    this.pendingCreates.set(key, { fingerprint, promise });
    return promise;
  }

  private async createTask(
    actor: TaskActor,
    input: {
      sessionId: string;
      requestId: string;
      title: string;
      mode: TaskMode;
      commands?: TaskCommand[];
      plan?: TaskPlanStep[];
      source?: "workflow" | "assistant";
      workflow?: TaskView["workflow"];
    },
  ): Promise<TaskView> {
    if (actor.kind === "mcp" && !this.clients.has(actor.connectionId))
      throw new Error("CLIENT_DISCONNECTED");
    const session = this.sessionFor(actor, input.sessionId);
    const key = JSON.stringify([
      actor.userId,
      actor.kind === "mcp"
        ? actor.clientId
        : actor.kind === "agent"
          ? "agent:" + actor.agentRunId
          : "human",
      input.requestId,
    ]);
    const old = this.requests.get(key);
    if (old) {
      const prior = this.owned(actor, old);
      if (
        prior.view.sessionId !== input.sessionId ||
        prior.view.title !== input.title ||
        prior.view.mode !== input.mode ||
        JSON.stringify(prior.initialPlan.workflow ?? null) !==
          JSON.stringify(input.workflow ?? null) ||
        JSON.stringify(prior.initialPlan.steps) !==
          JSON.stringify(input.plan ?? input.commands ?? [])
      )
        throw new Error("REQUEST_CONFLICT");
      return this.view(prior);
    }
    if (this.tasks.size >= 128 || this.requests.size >= 10000)
      throw new Error("TASK_CAPACITY_REACHED");
    const policy = await this.ports.policy(actor.userId),
      audit = this.ports.audit(actor.userId);
    const plan = validateTaskPlan(input.plan ?? input.commands ?? []);
    const commands = plan.filter(
      (step): step is TaskCommand => !isTaskFileStep(step),
    );
    const task: RecordTask = {
      initialPlan: {
        steps: structuredClone(plan),
        workflow: input.workflow ? structuredClone(input.workflow) : undefined,
      },
      workflowRuns: new Map(),
      workflowRequests: new Map(),
      continuedFailures: new Set(),
      userId: actor.userId,
      agentRunId: actor.kind === "agent" ? actor.agentRunId : undefined,
      clientId: actor.kind === "mcp" ? actor.clientId : undefined,
      connectionId: actor.kind === "mcp" ? actor.connectionId : undefined,
      session,
      policy,
      gateway: undefined as never,
      operationIds: [],
      operationRequests: new Map(),
      operationWorkflows: new Map(),
      pendingOperations: new Set(),
      steps: structuredClone(plan),
      fileBindings: {},
      generation: 0,
      attempts: new Set(),
      reviews: new Map(),
      listeners: new Set(),
      progressListeners: new Set(),
      view: {
        id: randomUUID(),
        sessionId: session.id,
        hostId: session.hostId,
        hostName: session.hostName,
        title: input.title,
        source:
          actor.kind === "mcp"
            ? "mcp"
            : actor.kind === "agent"
              ? "assistant"
              : (input.source ?? "workflow"),
        mode: input.mode,
        state: "awaiting-authorization",
        planRevision: 0,
        nextStep: 0,
        stepCount: plan.length,
        commands,
        plan: plan.some(isTaskFileStep) ? structuredClone(plan) : undefined,
        createdAt: Date.now(),
        workflow: input.workflow ? structuredClone(input.workflow) : undefined,
      },
    };
    await audit.record("task.created", {
      taskId: task.view.id,
      hostId: task.view.hostId,
      hostName: task.view.hostName,
      createdAt: task.view.createdAt,
      id: task.view.id,
      sessionId: session.id,
      title: input.title,
      source: task.view.source,
      clientId: task.clientId,
    });
    if (actor.kind === "mcp" && !this.clients.has(actor.connectionId))
      throw new Error("CLIENT_DISCONNECTED");
    task.gateway = new OperationGateway(
      session.control,
      () => ({ hostId: String(session.hostId), groupIds: session.groups() }),
      () => task.policy,
      session.executor,
      audit,
      Date.now,
      (_context, action) => {
        task.session.assertAvailable?.();
        if (!task.deadline || Date.now() >= task.deadline)
          throw new Error("TASK_AUTHORIZATION_EXPIRED");
        if (
          task.authorizedGroups &&
          JSON.stringify([...task.session.groups()].sort()) !==
            JSON.stringify(task.authorizedGroups)
        )
          throw new Error("HOST_SCOPE_CHANGED");
        if (
          action.type === "terminal.command" &&
          !this.inScope(task, action.cwd)
        )
          throw new Error("TASK_SCOPE_EXCEEDED");
      },
      session.files,
    );
    const unsubscribe = session.control.subscribe(() => {
      if (task.lease && !inactive(task.view.state)) {
        try {
          session.control.assertLease(task.lease);
        } catch {
          task.generation++;
          task.view.state = "paused-human";
          task.probe?.dispose();
        }
      }
      if (session.control.snapshot().closed) {
        this.closeDirectorySteps(task);
        unsubscribe();
      }
    });
    task.unsubscribe = unsubscribe;
    this.tasks.set(task.view.id, task);
    this.requests.set(key, task.view.id);
    if (task.clientId)
      this.ports.notifyTask?.(task.view.sessionId, task.view.id);
    return this.view(task);
  }

  attachWorkflow(
    actor: TaskActor,
    taskId: string,
    input: AttachWorkflow,
  ): Promise<TaskWorkflowRun> {
    const task = this.owned(actor, taskId),
      frozen = structuredClone(input);
    if (
      actor.kind === "mcp" &&
      (actor.connectionId !== task.connectionId ||
        !this.clients.has(actor.connectionId))
    )
      return Promise.reject(new Error("CLIENT_DISCONNECTED"));
    if (
      !frozen.requestId ||
      frozen.requestId.length > 128 ||
      !frozen.name ||
      frozen.name.length > 120 ||
      !(frozen.plan ?? frozen.commands).length ||
      (frozen.plan ?? frozen.commands).length > 100 ||
      Buffer.byteLength(
        JSON.stringify(frozen.plan ?? frozen.commands),
        "utf8",
      ) > 512000
    )
      return Promise.reject(new Error("INVALID_WORKFLOW_RUN"));
    validateTaskPlan(frozen.plan ?? frozen.commands);
    fileBindingsSchema.parse(frozen.fileBindings ?? {});
    const fingerprint = JSON.stringify([
        frozen.workflow,
        frozen.plan ?? frozen.commands,
        frozen.fileBindings ?? {},
        frozen.name,
      ]),
      prior = task.workflowRequests.get(frozen.requestId);
    if (prior)
      return prior.fingerprint === fingerprint
        ? prior.promise.then((run) => this.workflowSummary(task, run.id))
        : Promise.reject(new Error("REQUEST_CONFLICT"));
    if (task.workflowRequests.size >= 64)
      return Promise.reject(new Error("WORKFLOW_RUN_LIMIT"));
    const promise = this.attachTaskWorkflow(actor, task, frozen);
    task.workflowRequests.set(frozen.requestId, { fingerprint, promise });
    return promise;
  }
  private async attachTaskWorkflow(
    actor: TaskActor,
    task: RecordTask,
    input: AttachWorkflow,
  ): Promise<TaskWorkflowRun> {
    this.sessionFor(actor, task.view.sessionId);
    if (
      task.directoryReservation ||
      task.initialPlan.steps.length ||
      task.steps.length ||
      task.activeWorkflowRunId ||
      task.attachingWorkflow ||
      task.submitting ||
      this.authorizing.has(task.view.id) ||
      ![
        "awaiting-authorization",
        "ready",
        "paused-human",
        "paused-error",
      ].includes(task.view.state)
    )
      throw new Error("WORKFLOW_IN_PROGRESS");
    if (
      this.pendingReconciliation(task) ||
      task.operationIds.some((id) =>
        ["proposed", "queued", "running", "awaiting-approval"].includes(
          task.gateway.get(id).status,
        ),
      )
    )
      throw new Error("RECONCILIATION_REQUIRED");
    if (task.workflowRuns.size >= 32) throw new Error("WORKFLOW_RUN_LIMIT");
    const version = task.generation,
      check = () => {
        const current = task.session.control.snapshot();
        if (
          input.expectedGroupIds &&
          JSON.stringify([...task.session.groups()].sort()) !==
            JSON.stringify(input.expectedGroupIds)
        )
          throw new Error("HOST_SCOPE_CHANGED");
        if (
          task.generation !== version ||
          current.generation !== input.expectedControl.generation ||
          current.controlEpoch !== input.expectedControl.controlEpoch ||
          current.closed
        )
          throw new Error("STALE_CONTROL");
      };
    check();
    const plan = validateTaskPlan(input.plan ?? input.commands);
    this.validateBindings(
      task,
      plan,
      input.fileBindings ?? {},
      task.view.state === "ready" ? 0 : plan.length,
    );
    task.attachingWorkflow = true;
    try {
      const run: TaskWorkflowRecord = {
        commands: structuredClone(input.commands),
        plan: structuredClone(plan),
        fileBindings: structuredClone(input.fileBindings ?? {}),
        summary: {
          id: randomUUID(),
          taskId: task.view.id,
          name: input.name,
          workflow: structuredClone(input.workflow),
          state: task.view.state,
          nextStep: 0,
          stepCount: plan.length,
          operationIds: [],
          createdAt: Date.now(),
        },
      };
      await this.ports.audit(task.userId).record("workflow.attached", {
        taskId: task.view.id,
        workflowRunId: run.summary.id,
        workflow: input.workflow,
        name: input.name,
        commands: input.commands,
        plan,
        fileBindings: input.fileBindings,
      });
      check();
      task.workflowRuns.set(run.summary.id, run);
      task.activeWorkflowRunId = run.summary.id;
      task.view.planRevision = (task.view.planRevision ?? 0) + 1;
      task.view.workflow = structuredClone(input.workflow);
      task.view.commands = structuredClone(input.commands);
      task.steps = structuredClone(plan);
      task.fileBindings = structuredClone(input.fileBindings ?? {});
      task.view.plan = plan.some(isTaskFileStep)
        ? structuredClone(plan)
        : undefined;
      task.view.fileBindings = structuredClone(task.fileBindings);
      task.view.stepCount = task.steps.length;
      task.view.nextStep = 0;
      task.workflowCwd = task.view.cwd;
      task.reviewedPlanId = undefined;
      if (task.view.state === "ready") void this.pump(task, version);
      return this.workflowSummary(task, run.summary.id);
    } finally {
      task.attachingWorkflow = false;
    }
  }
  private workflowSummary(
    task: RecordTask,
    id: string,
    compact = false,
  ): TaskWorkflowRun {
    const run = task.workflowRuns.get(id);
    if (!run) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    return structuredClone({
      ...run.summary,
      ...(compact
        ? { operationIds: [], operationCount: run.summary.operationIds.length }
        : {}),
      ...(task.activeWorkflowRunId === id
        ? {
            state: task.view.state,
            nextStep: task.view.nextStep,
            error: task.view.error,
          }
        : {}),
    });
  }
  workflowOperation(
    actor: TaskActor,
    taskId: string,
    runId: string,
    operationId: string,
  ): TaskOperation {
    const task = this.owned(actor, taskId),
      run = task.workflowRuns.get(runId);
    if (!run?.summary.operationIds.includes(operationId))
      throw Error("OPERATION_NOT_FOUND");
    if (task.operationIds.includes(operationId))
      return this.projectOperation(task, operationId);
    const historical = task.recoveryHistory?.find(
      (op) => op.id === operationId && op.workflowRunId === runId,
    );
    if (!historical) throw Error("OPERATION_NOT_FOUND");
    return redact(structuredClone(historical)) as TaskOperation;
  }
  workflowRunSummary(actor: TaskActor, taskId: string, runId: string) {
    return this.workflowSummary(this.owned(actor, taskId), runId);
  }
  workflowRun(actor: TaskActor, taskId: string, runId: string) {
    const task = this.owned(actor, taskId);
    return {
      ...this.workflowSummary(task, runId),
      commands: structuredClone(task.workflowRuns.get(runId)!.commands),
      plan: structuredClone(task.workflowRuns.get(runId)!.plan),
    };
  }

  list(
    actor: TaskActor,
    sessionId?: string,
    options?: TaskViewOptions,
  ): TaskView[] {
    return [...this.tasks.values()]
      .filter(
        (task) =>
          task.userId === actor.userId &&
          (!sessionId || task.view.sessionId === sessionId) &&
          (actor.kind === "human" ||
            (actor.kind === "agent"
              ? task.agentRunId === actor.agentRunId
              : task.clientId === actor.clientId &&
                actor.allowedHostIds.includes(task.view.hostId))),
      )
      .map((task) => this.view(task, options));
  }
  get(actor: TaskActor, taskId: string, options?: TaskViewOptions): TaskView {
    return this.view(this.owned(actor, taskId), options);
  }

  state(actor: TaskActor, taskId: string, includeMatches = true) {
    const task = this.owned(actor, taskId);
    return {
      id: task.view.id,
      sessionId: task.view.sessionId,
      hostId: task.view.hostId,
      hostName: task.view.hostName,
      state: task.view.state,
      cwd: task.view.cwd,
      error: task.view.error,
      operationCount: task.operationIds.length,
      activeWorkflowRunId: task.activeWorkflowRunId,
      control: task.session.control.snapshot(),
      policyRevision: task.policy.revision,
      authorization: task.scope
        ? {
            matches: includeMatches
              ? structuredClone(task.scope.matches ?? [])
              : [],
            fileScopes: structuredClone(task.scope.fileScopes ?? []),
            directory: task.scope.directory,
            maxOperations: task.scope.maxOperations,
            expiresAt: task.deadline,
          }
        : undefined,
    };
  }
  operation(actor: TaskActor, taskId: string, operationId: string) {
    const task = this.owned(actor, taskId);
    if (!task.operationIds.includes(operationId))
      throw new Error("OPERATION_NOT_FOUND");
    const op = task.gateway.get(operationId);
    return {
      ...op,
      reviewed: task.reviews.get(op.id),
      output: redact(op.output) as string | undefined,
    };
  }
  observeControl(
    actor: TaskActor,
    taskId: string,
    listener: () => void,
  ): () => void {
    const task = this.owned(actor, taskId);
    task.listeners.add(listener);
    const unsubscribe = task.session.control.subscribe(listener);
    return () => {
      task.listeners.delete(listener);
      unsubscribe();
    };
  }
  observeTask(actor: TaskActor, taskId: string, listener: () => void) {
    const task = this.owned(actor, taskId);
    task.progressListeners.add(listener);
    const unsubscribe = task.session.control.subscribe(listener);
    return () => {
      task.progressListeners.delete(listener);
      unsubscribe();
    };
  }
  private progress(task: RecordTask) {
    for (const listener of task.progressListeners) {
      try {
        listener();
      } catch {
        // A disconnected observer cannot interrupt task state transitions.
      }
    }
  }
  private notify(task: RecordTask): void {
    this.progress(task);
    for (const listener of task.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot restore revoked authority. */
      }
    }
  }
  suspend(actor: TaskActor, taskId: string, code: string): void {
    this.pause(this.owned(actor, taskId), code);
  }

  async authorize(
    actor: TaskActor,
    taskId: string,
    scope: TaskAuthorization,
    viewOptions?: TaskViewOptions,
  ): Promise<TaskView> {
    this.human(actor);
    if (
      this.authorizing.has(taskId) ||
      this.owned(actor, taskId).attachingWorkflow
    )
      throw new Error("TASK_STATE_INVALID");
    if (
      (scope.fileScopes?.length ?? 0) > 128 ||
      (scope.fileScopes ?? []).some(
        (item) => !fileScopeSchema.safeParse(item).success,
      ) ||
      !Number.isInteger(scope.maxOperations) ||
      scope.maxOperations < 1 ||
      scope.maxOperations > 5000 ||
      !Number.isFinite(scope.durationMinutes) ||
      scope.durationMinutes < 1 ||
      scope.durationMinutes > 480 ||
      (scope.directory &&
        (!scope.directory.startsWith("/") ||
          /[\x00-\x1f\x7f]/.test(scope.directory)))
    )
      throw new Error("INVALID_TASK_GRANT");
    this.authorizing.add(taskId);
    try {
      return await this.authorizeTask(
        actor,
        taskId,
        structuredClone(scope),
        viewOptions,
      );
    } finally {
      this.authorizing.delete(taskId);
    }
  }

  private async authorizeTask(
    actor: TaskActor,
    taskId: string,
    scope: TaskAuthorization,
    viewOptions?: TaskViewOptions,
  ): Promise<TaskView> {
    this.human(actor);
    const task = this.owned(actor, taskId);
    this.sessionFor(actor, task.view.sessionId);
    if (task.connectionId && !this.clients.has(task.connectionId))
      throw new Error("CLIENT_DISCONNECTED");
    if (task.recoverySaving || task.recoveryRestoring)
      throw Error("TASK_RECOVERY_BUSY");
    if (terminalState(task.view.state) || !inactive(task.view.state))
      throw new Error("TASK_STATE_INVALID");
    task.session.assertAvailable?.();
    if (!scope.shellReady) throw new Error("SHELL_READY_CONFIRMATION_REQUIRED");
    if (
      (task.view.planRevision ?? 0) > 0 &&
      scope.planRevision !== task.view.planRevision
    )
      throw new Error("STALE_PLAN");
    if (task.recoveryDecisionRequired && !scope.reconciliation)
      throw Error("RECONCILIATION_REQUIRED");
    const initiatingVersion = task.generation;
    const groups = [...task.session.groups()].sort();
    const currentPolicy = await this.ports.policy(actor.userId);
    if (scope.policyRevision !== currentPolicy.revision)
      throw new Error("POLICY_CHANGED");
    while (task.steps[task.view.nextStep]?.operationId) {
      const step = task.steps[task.view.nextStep],
        op = task.gateway.get(step.operationId!);
      if (op.status !== "succeeded" || op.error || op.auditGap) break;
      if (isTaskFileStep(step) && step.kind === "directory-transfer") {
        const cursor = this.directoryCursor(task, step);
        cursor.accept(op);
        step.operationId = undefined;
        if (!cursor.done) break;
        cursor.close();
      }
      task.view.nextStep++;
    }
    const pendingStep = task.steps[task.view.nextStep];
    const prior = pendingStep?.operationId
      ? task.gateway.get(pendingStep.operationId)
      : task.steps.length
        ? undefined
        : this.pendingReconciliation(task);
    if (
      prior &&
      ["unknown", "failed"].includes(prior.status) &&
      !scope.reconciliation
    )
      throw new Error("RECONCILIATION_REQUIRED");
    const fileBindings = scope.fileBindings ?? task.fileBindings;
    this.validateBindings(
      task,
      task.steps,
      fileBindings,
      task.view.nextStep +
        ((prior || task.recoveryDecisionRequired) &&
        scope.reconciliation === "skip"
          ? 1
          : 0),
    );
    await this.ports.audit(actor.userId).record("task.authorization", {
      taskId,
      scope,
      reconciliationOperationId: prior?.id,
    });
    if (
      task.generation !== initiatingVersion ||
      !inactive(task.view.state) ||
      terminalState(task.view.state)
    )
      throw new Error("STALE_CONTROL");
    task.view.state = "authorizing";
    task.lease = undefined;
    const version = ++task.generation;
    task.policy = currentPolicy;
    try {
      if (
        JSON.stringify([...task.session.groups()].sort()) !==
        JSON.stringify(groups)
      )
        throw new Error("HOST_SCOPE_CHANGED");
      task.session.assertAvailable?.();
      task.lease = task.session.control.grant(
        {
          kind: "automation",
          ownerType: task.clientId
            ? "mcp-client"
            : task.view.source === "workflow"
              ? "workflow-run"
              : "agent-task",
          ownerId: task.connectionId ?? taskId,
        },
        { generation: scope.generation, controlEpoch: scope.controlEpoch },
      );
      task.probe = task.session.executor.prepareContext();
      task.probe.beforeSend?.();
      if (
        JSON.stringify([...task.session.groups()].sort()) !==
        JSON.stringify(groups)
      )
        throw new Error("HOST_SCOPE_CHANGED");
      task.session.assertAvailable?.();
      task.session.control.commitWrite(task.lease, task.probe.bytes);
      const context = await task.probe.completion;
      task.probe.dispose();
      task.probe = undefined;
      task.session.control.assertLease(task.lease);
      if (context.protocolError) throw new Error("SHELL_PROTOCOL_INVALID");
      if (context.timedOut) throw new Error("SHELL_CONTEXT_TIMEOUT");
      if (context.exitCode !== 0 || !context.cwd)
        throw new Error("SHELL_CONTEXT_UNKNOWN");
      const directory = scope.directory || context.cwd;
      if (!directory.startsWith("/")) throw new Error("INVALID_DIRECTORY");
      task.view.cwd = posix.normalize(directory);
      if (task.view.workflow && !task.workflowCwd)
        task.workflowCwd = task.view.cwd;
      task.fileBindings = structuredClone(fileBindings);
      task.view.fileBindings = Object.keys(fileBindings).length
        ? structuredClone(fileBindings)
        : undefined;
      task.scope = {
        ...structuredClone(scope),
        fileBindings: structuredClone(fileBindings),
        directory: task.view.cwd,
      };
      task.deadline = Date.now() + scope.durationMinutes * 60000;
      task.attempts.clear();
      task.view.error = undefined;
      if (task.recoveryDecisionRequired) {
        this.recordRecoveryReview(task, scope.reconciliation!);
        if (scope.reconciliation === "skip") {
          if (task.view.nextStep < task.steps.length) task.view.nextStep++;
          task.view.hasFailures = true;
          if (task.activeWorkflowRunId)
            task.workflowRuns.get(
              task.activeWorkflowRunId,
            )!.summary.hasFailures = true;
        }
        task.recoveryDecisionRequired = false;
      }
      if (prior && scope.reconciliation)
        task.reviews.set(prior.id, {
          decision: scope.reconciliation,
          at: Date.now(),
        });
      if (scope.reconciliation === "skip" && prior) {
        pendingStep?.directoryCursor?.close();
        task.view.nextStep++;
        task.view.hasFailures = true;
        if (task.activeWorkflowRunId)
          task.workflowRuns.get(task.activeWorkflowRunId)!.summary.hasFailures =
            true;
      }
      for (let i = task.view.nextStep; i < task.steps.length; i++) {
        const step = task.steps[i],
          cursor = step.directoryCursor;
        if (
          cursor &&
          isTaskFileStep(step) &&
          ((i === task.view.nextStep &&
            scope.reconciliation === "retry" &&
            cursor.canRestart) ||
            !cursor.matchesBinding(fileBindings[step.localFile]))
        ) {
          cursor.close();
          step.directoryCursor = undefined;
        }
        step.operationId = undefined;
      }
      const matches = task.steps.length
        ? task.steps
            .filter(
              (step): step is TaskCommand & { operationId?: string } =>
                !isTaskFileStep(step),
            )
            .map((step) => ({
              kind: "program-args" as const,
              program: step.program,
              args: step.args,
            }))
        : (scope.matches ?? []);
      if (task.activeWorkflowRunId) matches.push(...(scope.matches ?? []));
      if (
        JSON.stringify([...task.session.groups()].sort()) !==
        JSON.stringify(groups)
      )
        throw new Error("HOST_SCOPE_CHANGED");
      task.authorizedGroups = groups;
      task.scope.matches = structuredClone(matches);
      task.reviewedPlanId = scope.allowReviewedPlan
        ? (task.activeWorkflowRunId ?? "initial-plan")
        : undefined;
      task.gateway.authorizeTask(taskId, task.lease, {
        matches,
        cwdScopes: [task.view.cwd],
        fileScopes: scope.fileScopes,
        maxOperations: scope.maxOperations,
        expiresAt: task.deadline,
        expectedPolicyRevision: scope.policyRevision,
      });
      if (task.generation !== version) throw new Error("STALE_CONTROL");
      task.view.state = "ready";
      this.progress(task);
      void this.pump(task, version);
      return this.view(task, viewOptions);
    } catch (error) {
      try {
        task.probe?.dispose();
      } catch {
        /* Revocation must still complete if observer cleanup fails. */
      }
      task.probe = undefined;
      if (task.generation === version)
        this.pause(
          task,
          error instanceof Error ? error.message : "AUTHORIZATION_FAILED",
        );
      throw error;
    }
  }

  async saveRecovery(
    actor: TaskActor,
    taskId: string,
    persist: (checkpoint: TaskExecutionCheckpoint) => Promise<void>,
  ) {
    const task = this.owned(actor, taskId);
    if (task.recoverySaving || task.recoveryRestoring)
      throw Error("TASK_RECOVERY_BUSY");
    if (
      task.view.source === "assistant" &&
      (!task.recoveryAgent || actor.kind !== "agent")
    )
      throw Error("TASK_RECOVERY_AGENT_ADAPTER_REQUIRED");
    task.recoverySaving = true;
    try {
      this.pause(task, "TASK_RECOVERY_SAVING");
      const deadline = Date.now() + 10000;
      let checkpoint: TaskExecutionCheckpoint;
      for (;;) {
        try {
          checkpoint = this.recoverySnapshot(actor, taskId);
          break;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "TASK_RECOVERY_BUSY" ||
            Date.now() >= deadline
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      if (checkpoint.resourceRecoveryRequired)
        throw Error("TASK_RECOVERY_RESOURCES_REQUIRED");
      await persist(checkpoint);
      this.cancel(actor, taskId);
      await this.ports.audit(actor.userId).record("task.recovery-saved", {
        taskId,
        nextStep: checkpoint.nextStep,
      });
      return checkpoint;
    } finally {
      task.recoverySaving = false;
    }
  }
  /** Captures trusted runtime state; no external transport may supply a snapshot. */
  recoverySnapshot(actor: TaskActor, taskId: string): TaskExecutionCheckpoint {
    const task = this.owned(actor, taskId);
    if (task.view.source === "assistant" && !task.recoveryAgent)
      throw Error("TASK_RECOVERY_AGENT_ADAPTER_REQUIRED");
    if (
      task.pumping !== undefined ||
      task.submitting ||
      task.attachingWorkflow ||
      task.probe ||
      task.archiving ||
      task.operationIds.some((id) =>
        ["running", "queued"].includes(task.gateway.status(id)),
      )
    )
      throw Error("TASK_RECOVERY_BUSY");
    if (!inactive(task.view.state)) throw Error("TASK_RECOVERY_PAUSE_REQUIRED");
    return this.captureRecovery(task);
  }
  private captureRecovery(
    task: RecordTask,
    inFlight?: string,
  ): TaskExecutionCheckpoint {
    if (!task.session.acceptedHostKey)
      throw Error("TASK_RECOVERY_HOST_KEY_REQUIRED");
    const operations = task.operationIds.map((id) =>
      this.projectOperation(task, id, 8000),
    );
    if (inFlight) {
      const op = operations.find((op) => op.id === inFlight);
      if (op) {
        op.status = "unknown";
        op.error = "TASK_RECOVERY_INTERRUPTED";
      }
    }
    let nextStep = task.view.nextStep;
    while (nextStep < task.steps.length) {
      const step = task.steps[nextStep],
        op = operations.find((op) => op.id === step.operationId);
      if (step.directoryCursor?.done) {
        nextStep++;
        continue;
      }
      if (
        !op ||
        op.status !== "succeeded" ||
        op.error ||
        op.auditGap ||
        (step.directoryCursor && !step.directoryCursor.done)
      )
        break;
      nextStep++;
    }
    const current = task.steps[nextStep],
      operation = current?.operationId
        ? operations.find((op) => op.id === current.operationId)
        : undefined;
    const uncertain = (op: TaskOperation) =>
      (["unknown", "failed", "running"].includes(op.status) && !op.reviewed) ||
      !!op.auditGap;
    const directoryState = current?.directoryCursor
      ? current.directoryCursor.checkpoint?.()
      : current?.directoryRecovery;
    const resourceRecoveryRequired =
      (operation?.action.type === "file.directory.entry" &&
        ["unknown", "running"].includes(operation.status)) ||
      (!!current?.directoryCursor &&
        !current.directoryCursor.canRestart &&
        !current.directoryCursor.done &&
        !directoryState) ||
      !!operation?.fileResult?.temporaryPath ||
      !!operation?.fileResult?.transfer?.cleanupRequired;
    const steps = task.steps.map(
      ({
        operationId: _id,
        directoryCursor: _cursor,
        directoryRecovery: _recovery,
        ...step
      }) => structuredClone(step),
    );
    const workflowState = task.workflowRuns.size
      ? {
          initialPlan: structuredClone(task.initialPlan),
          activeRunId: task.activeWorkflowRunId,
          runs: [...task.workflowRuns].map(([id, run]) => ({
            summary: {
              ...this.workflowSummary(task, id),
              ...(id === task.activeWorkflowRunId ? { nextStep } : {}),
            },
            steps: structuredClone(run.plan ?? run.commands),
          })),
        }
      : undefined;
    return {
      schemaVersion: 1,
      directoryState,
      completed: ["completed", "completed-with-errors"].includes(
        task.view.state,
      ),
      workflowState,
      workflowCwd: task.workflowCwd,
      ai: task.recoveryAgent?.(),
      id: task.view.id,
      userId: task.userId,
      host: {
        id: task.view.hostId,
        name: task.view.hostName,
        peer: task.session.acceptedHostKey,
      },
      title: task.view.title,
      source: task.view.source,
      clientId: task.clientId,
      mode: task.view.mode,
      steps,
      nextStep,
      workflow: task.view.workflow,
      cwd: task.view.cwd,
      hasFailures: !!task.view.hasFailures,
      resourceRecoveryRequired:
        resourceRecoveryRequired ||
        !!task.directoryReservation ||
        operations.some(
          (op) =>
            !op.reviewed &&
            (!!op.fileResult?.temporaryPath ||
              !!op.fileResult?.transfer?.cleanupRequired),
        ),
      reconciliationRequired:
        task.recoveryDecisionRequired ||
        (task.steps.length
          ? !!operation && uncertain(operation)
          : operations.some(uncertain)),
      operations: [...(task.recoveryHistory ?? []), ...operations],
      createdAt: task.view.createdAt,
      savedAt: Date.now(),
    };
  }
  bindRecoveryAgent(
    actor: TaskActor,
    taskId: string,
    capture: () => AiExecutionCheckpoint,
  ) {
    const task = this.owned(actor, taskId);
    if (actor.kind !== "agent" || task.view.source !== "assistant")
      throw Error("TASK_RECOVERY_OWNER_MISMATCH");
    task.recoveryAgent = capture;
  }
  async persistRecoveryState(
    actor: TaskActor,
    taskId: string,
    ai?: AiExecutionCheckpoint,
  ) {
    const task = this.owned(actor, taskId);
    if (!task.recoveryEnabled) return;
    if (ai && (actor.kind !== "agent" || !task.recoveryAgent))
      throw Error("TASK_RECOVERY_OWNER_MISMATCH");
    if (!this.ports.persistRecovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
    const checkpoint = this.captureRecovery(task);
    if (ai) checkpoint.ai = structuredClone(ai);
    await this.ports.persistRecovery(
      checkpoint,
      terminalState(task.view.state),
    );
  }
  enableRecovery(actor: TaskActor, taskId: string) {
    const task = this.owned(actor, taskId);
    task.recoveryEnabled = true;
    task.recoveryRestoring = false;
  }
  private async persistRecovery(task: RecordTask, inFlight?: string) {
    if (task.recoveryEnabled) {
      if (!this.ports.persistRecovery) throw Error("TASK_RECOVERY_UNAVAILABLE");
      await this.ports.persistRecovery(
        this.captureRecovery(task, inFlight),
        terminalState(task.view.state),
      );
    }
  }
  private recordRecoveryReview(task: RecordTask, decision: "retry" | "skip") {
    const op = [...(task.recoveryHistory ?? [])]
      .reverse()
      .find(
        (op) =>
          !op.reviewed &&
          ["unknown", "failed", "running"].includes(op.status) &&
          (!task.activeWorkflowRunId ||
            op.workflowRunId === task.activeWorkflowRunId),
      );
    if (op) op.reviewed = { decision, at: Date.now() };
  }
  async restoreRecovery(
    actor: TaskActor,
    checkpoint: TaskExecutionCheckpoint,
    input: {
      sessionId: string;
      requestId: string;
      reconciliation?: "retry" | "skip";
    },
  ) {
    const session = this.sessionFor(actor, input.sessionId);
    if (
      checkpoint.userId !== actor.userId ||
      (checkpoint.source === "assistant"
        ? actor.kind !== "agent" || !checkpoint.ai
        : actor.kind === "agent") ||
      (checkpoint.source === "mcp" &&
        (actor.kind !== "mcp" || checkpoint.clientId !== actor.clientId)) ||
      (checkpoint.source === "workflow" && actor.kind !== "human")
    )
      throw Error("TASK_RECOVERY_OWNER_MISMATCH");
    if (
      session.hostId !== checkpoint.host.id ||
      session.hostName !== checkpoint.host.name ||
      !session.acceptedHostKey ||
      session.acceptedHostKey !== checkpoint.host.peer
    )
      throw Error("TASK_RECOVERY_HOST_CHANGED");
    if (checkpoint.completed) throw Error("TASK_RECOVERY_NOT_AVAILABLE");
    if (checkpoint.resourceRecoveryRequired)
      throw Error("TASK_RECOVERY_RESOURCES_REQUIRED");
    if (
      checkpoint.reconciliationRequired &&
      !input.reconciliation &&
      actor.kind === "human"
    )
      throw Error("RECONCILIATION_REQUIRED");
    const steps = validateTaskPlan(checkpoint.steps);
    if (
      !Number.isInteger(checkpoint.nextStep) ||
      checkpoint.nextStep < 0 ||
      checkpoint.nextStep > steps.length
    )
      throw Error("TASK_RECOVERY_INVALID");
    const created = await this.create(actor, {
      sessionId: input.sessionId,
      requestId: input.requestId,
      title: checkpoint.title,
      mode: checkpoint.mode,
      plan: checkpoint.workflowState?.initialPlan.steps ?? steps,
      workflow: checkpoint.workflowState
        ? checkpoint.workflowState.initialPlan.workflow
        : checkpoint.workflow,
    });
    const task = this.owned(actor, created.id);
    task.recoveryRestoring = true;
    task.view.nextStep =
      checkpoint.nextStep +
      (checkpoint.reconciliationRequired &&
      input.reconciliation === "skip" &&
      checkpoint.nextStep < steps.length
        ? 1
        : 0);
    task.view.hasFailures =
      checkpoint.hasFailures ||
      (checkpoint.reconciliationRequired && input.reconciliation === "skip");
    task.recoveryDecisionRequired =
      checkpoint.reconciliationRequired && !input.reconciliation;
    task.workflowCwd =
      checkpoint.workflowCwd ??
      (checkpoint.workflowState ? undefined : checkpoint.cwd);
    task.view.cwd = checkpoint.cwd;
    task.view.recovery = {
      recordId: checkpoint.id,
      completedSteps: checkpoint.nextStep,
    };
    task.recoveryHistory = structuredClone(checkpoint.operations);
    if (checkpoint.workflowState) {
      for (const saved of checkpoint.workflowState.runs) {
        const summary = structuredClone(saved.summary);
        summary.taskId = task.view.id;
        summary.restoredFromTaskId = checkpoint.id;
        task.workflowRuns.set(summary.id, {
          summary,
          commands: saved.steps.filter(
            (step): step is TaskCommand => !isTaskFileStep(step),
          ),
          plan: structuredClone(saved.steps),
          fileBindings: {},
        });
      }
      task.activeWorkflowRunId = checkpoint.workflowState.activeRunId;
      if (task.activeWorkflowRunId) {
        const active = task.workflowRuns.get(task.activeWorkflowRunId)!;
        task.steps = structuredClone(steps);
        task.view.commands = steps.filter(
          (step): step is TaskCommand => !isTaskFileStep(step),
        );
        task.view.plan = steps.some(isTaskFileStep)
          ? structuredClone(steps)
          : undefined;
        task.view.stepCount = steps.length;
        task.view.workflow = structuredClone(active.summary.workflow);
        task.view.planRevision = 1;
        if (
          checkpoint.reconciliationRequired &&
          input.reconciliation === "skip"
        )
          active.summary.hasFailures = true;
      }
    }
    if (checkpoint.directoryState && task.view.nextStep === checkpoint.nextStep)
      task.steps[task.view.nextStep].directoryRecovery = structuredClone(
        checkpoint.directoryState,
      );
    if (checkpoint.reconciliationRequired && input.reconciliation)
      this.recordRecoveryReview(task, input.reconciliation);
    try {
      await this.ports.audit(actor.userId).record("task.recovered", {
        taskId: task.view.id,
        originalTaskId: checkpoint.id,
        nextStep: task.view.nextStep,
        reconciliation: input.reconciliation,
      });
    } catch (error) {
      this.cancel(actor, task.view.id);
      throw error;
    }
    return this.view(task);
  }

  checkWorkflowFileBindings(
    actor: TaskActor,
    taskId: string,
    plan: TaskPlanStep[],
    bindings: TaskFileBindings,
  ) {
    this.fileObservationContext(actor, taskId);
    this.validateBindings(this.owned(actor, taskId), plan, bindings);
  }
  private closeDirectorySteps(task: RecordTask) {
    for (const step of task.steps) step.directoryCursor?.close();
  }
  private directoryCursor(
    task: RecordTask,
    step: TaskFileStep & {
      directoryCursor?: DirectoryStepCursor;
      directoryRecovery?: DirectoryStepCheckpoint;
    },
  ): DirectoryStepCursor {
    if (!this.ports.directorySteps)
      throw Error("WORKFLOW_DIRECTORY_EXECUTOR_REQUIRED");
    return (step.directoryCursor ??= this.ports.directorySteps.open(
      task.userId,
      task.view.id,
      step,
      task.fileBindings,
      step.directoryRecovery,
    ));
  }
  private validateBindings(
    task: RecordTask,
    plan: RuntimeStep[],
    raw: TaskFileBindings,
    start = 0,
  ) {
    const bindings = fileBindingsSchema.parse(raw),
      slots = new Set(plan.filter(isTaskFileStep).map((s) => s.localFile));
    if (Object.keys(bindings).some((name) => !slots.has(name)))
      throw Error("WORKFLOW_FILE_SLOT_INVALID");
    const downloadGrants = new Set<string>();
    for (const step of plan.slice(start))
      if (isTaskFileStep(step)) {
        if (step.kind === "directory-transfer") {
          if (!this.ports.directorySteps)
            throw Error("WORKFLOW_DIRECTORY_EXECUTOR_REQUIRED");
          if (
            step.directoryCursor &&
            !step.directoryCursor.canRestart &&
            !step.directoryCursor.matchesBinding(bindings[step.localFile])
          )
            throw Error("WORKFLOW_DIRECTORY_BINDING_LOCKED");
          this.ports.directorySteps.validate(
            task.userId,
            task.view.id,
            step,
            bindings,
          );
        } else {
          const action = fileStepAction(step, bindings);
          if (step.direction === "download") {
            if (downloadGrants.has(action.localGrantId))
              throw Error("WORKFLOW_DOWNLOAD_TARGET_REUSED");
            downloadGrants.add(action.localGrantId);
          }
          if (!this.ports.validateFileBinding)
            throw Error("FILE_LOCAL_GRANT_REQUIRED");
          this.ports.validateFileBinding(task.userId, task.view.id, action);
        }
      }
  }
  private inScope(task: RecordTask, cwd: string): boolean {
    const root = posix.normalize(task.scope?.directory || task.view.cwd || "/");
    const target = posix.normalize(cwd);
    return (
      target === root ||
      target.startsWith(root === "/" ? "/" : root.replace(/\/$/, "") + "/")
    );
  }
  private async pump(task: RecordTask, version: number): Promise<void> {
    if (!task.steps.length || task.pumping === version) return;
    task.pumping = version;
    try {
      while (
        version === task.generation &&
        ["ready", "running"].includes(task.view.state) &&
        task.view.nextStep < task.steps.length
      ) {
        const step = task.steps[task.view.nextStep];
        const cursor =
          isTaskFileStep(step) && step.kind === "directory-transfer"
            ? this.directoryCursor(task, step)
            : undefined;
        if (cursor?.done) {
          cursor.close();
          task.view.nextStep++;
          continue;
        }
        let op: OperationView;
        if (step.operationId) op = task.gateway.get(step.operationId);
        else {
          const action = cursor
            ? cursor.next()!
            : isTaskFileStep(step)
              ? fileStepAction(step, task.fileBindings)
              : {
                  type: "terminal.command" as const,
                  program: step.program,
                  args: step.args,
                  cwd:
                    step.cwd ??
                    (task.view.workflow?.shellState === "explicit-cwd"
                      ? task.workflowCwd!
                      : task.view.cwd!),
                  timeoutMs: step.timeoutMs,
                };
          if (isTaskFileStep(step) && step.kind === "file-transfer")
            this.ports.validateFileBinding?.(
              task.userId,
              task.view.id,
              action as FileTransferAction,
            );
          op = await this.propose(
            task,
            action,
            `${task.activeWorkflowRunId ?? "initial"}-step-${task.view.nextStep}${cursor ? "-directory-" + cursor.requestIndex : ""}-v${version}`,
          );
          if (version !== task.generation) break;
          step.operationId = op.id;
        }
        if (
          task.view.mode === "automatic" &&
          task.scope?.allowReviewedPlan &&
          task.reviewedPlanId ===
            (task.activeWorkflowRunId ?? "initial-plan") &&
          op.decision.outcome === "unknown" &&
          op.action.type === "terminal.command" &&
          this.inScope(task, op.action.cwd) &&
          Date.now() < task.deadline!
        ) {
          task.gateway.approveOnce(op.id, op.digest, task.scope.policyRevision);
        }
        const result = await this.dispatch(
          task,
          op.id,
          version,
          step.onFailure === "continue",
        );
        if (version !== task.generation) break;
        if (
          isTaskFileStep(step) &&
          step.kind === "file-transfer" &&
          (result.status === "succeeded" || canContinueStepFailure(result))
        ) {
          try {
            this.ports.releaseTransferProgress?.(
              task.userId,
              task.view.id,
              result.id,
            );
          } catch {
            /* Keep the verified operation result; progress may be released explicitly. */
          }
        }
        if (
          result.status !== "succeeded" &&
          !(step.onFailure === "continue" && canContinueStepFailure(result))
        )
          break;
        if (cursor) {
          if (result.status === "succeeded") {
            cursor.accept(result);
            step.operationId = undefined;
            if (!cursor.done) {
              task.view.state = "ready";
              continue;
            }
          }
          cursor.close();
        }
        if (result.status === "failed") {
          task.view.hasFailures = true;
          task.continuedFailures.add(result.id);
          const run =
            task.activeWorkflowRunId &&
            task.workflowRuns.get(task.activeWorkflowRunId);
          if (run) run.summary.hasFailures = true;
        }
        task.view.nextStep++;
        task.view.state = "ready";
        await this.persistRecovery(task);
      }
      if (
        version === task.generation &&
        task.steps.length &&
        task.view.nextStep === task.steps.length
      ) {
        if (task.activeWorkflowRunId) {
          const run = task.workflowRuns.get(task.activeWorkflowRunId)!;
          await this.ports.audit(task.userId).record("workflow.completed", {
            taskId: task.view.id,
            workflowRunId: run.summary.id,
            hasFailures: !!run.summary.hasFailures,
          });
          if (version !== task.generation) return;
          run.summary.state = run.summary.hasFailures
            ? "completed-with-errors"
            : "completed";
          run.summary.error = undefined;
          run.summary.nextStep = task.steps.length;
          run.summary.endedAt = Date.now();
          task.activeWorkflowRunId = undefined;
          task.reviewedPlanId = undefined;
          task.workflowCwd = undefined;
          task.steps = [];
          task.fileBindings = {};
          task.view.commands = [];
          task.view.plan = undefined;
          task.view.fileBindings = undefined;
          task.view.stepCount = 0;
          task.view.nextStep = 0;
          task.view.workflow = task.initialPlan.workflow;
          task.view.planRevision = (task.view.planRevision ?? 0) + 1;
          task.view.state = "ready";
          await this.persistRecovery(task);
          this.progress(task);
        } else {
          task.view.state = task.view.hasFailures
            ? "completed-with-errors"
            : "completed";
          this.returnControl(task);
          await this.ports.audit(task.userId).record("task.completed", {
            taskId: task.view.id,
            state: task.view.state,
            hasFailures: task.view.hasFailures ?? false,
          });
          await this.persistRecovery(task);
        }
      }
    } catch (error) {
      if (version === task.generation) {
        const code = error instanceof Error ? error.message : "TASK_FAILED";
        if (code === "APPROVAL_REQUIRED") task.view.state = "awaiting-approval";
        else this.pause(task, code);
      }
    } finally {
      if (task.pumping === version) task.pumping = undefined;
    }
  }

  private async propose(
    task: RecordTask,
    action: OperationAction,
    requestId: string,
  ): Promise<OperationView> {
    if (
      !task.lease ||
      !["ready", "running", "awaiting-approval"].includes(task.view.state)
    )
      throw new Error("TASK_NOT_RUNNING");
    const op = await task.gateway.propose(
      {
        taskId: task.view.id,
        requestId,
        mode: task.view.mode,
        origin: task.clientId
          ? "mcp"
          : task.view.source === "workflow"
            ? "workflow"
            : "agent",
        lease: task.lease,
      },
      action,
    );
    if (!task.operationRequests.has(op.context.requestId))
      task.operationIds.push(op.id);
    task.operationRequests.set(op.context.requestId, op.id);
    task.pendingOperations.add(op.id);
    if (task.activeWorkflowRunId) {
      const run = task.workflowRuns.get(task.activeWorkflowRunId)!;
      if (!run.summary.operationIds.includes(op.id))
        run.summary.operationIds.push(op.id);
      task.operationWorkflows.set(op.id, task.activeWorkflowRunId);
    }
    return op;
  }
  private async dispatch(
    task: RecordTask,
    operationId: string,
    version: number,
    continueOnFailure = false,
  ): Promise<OperationView> {
    if (version !== task.generation) throw new Error("STALE_CONTROL");
    if (!task.deadline || Date.now() >= task.deadline)
      throw new Error("TASK_AUTHORIZATION_EXPIRED");
    if (
      task.attempts.size >= (task.scope?.maxOperations ?? 0) &&
      !task.attempts.has(operationId)
    )
      throw new Error("TASK_BUDGET_EXCEEDED");
    task.attempts.add(operationId);
    task.view.state = "running";
    let result: OperationView;
    try {
      await this.persistRecovery(task, operationId);
      if (version !== task.generation) throw Error("STALE_CONTROL");
      result = await task.gateway.dispatch(operationId);
      await this.persistRecovery(task);
    } catch (error) {
      task.attempts.delete(operationId);
      throw error;
    }
    if (version === task.generation) {
      if (result.resultingCwd) task.view.cwd = result.resultingCwd;
      if (
        (result.status !== "succeeded" &&
          !(continueOnFailure && canContinueStepFailure(result))) ||
        result.auditGap ||
        (result.status === "succeeded" && result.error)
      )
        this.pause(task, result.error ?? "COMMAND_FAILED");
      else task.view.state = "ready";
      this.progress(task);
    }
    return result;
  }

  async submit(
    actor: TaskActor,
    taskId: string,
    command: TaskCommand,
    requestId: string,
  ): Promise<TaskView> {
    const task = this.owned(actor, taskId);
    const prior = task.operationIds
      .map((id) => task.gateway.get(id))
      .find((op) => op.context.requestId === requestId);
    const cwd =
      command.cwd ??
      (prior?.action.type === "terminal.command"
        ? prior.action.cwd
        : task.view.cwd!);
    return this.submitAction(
      actor,
      taskId,
      validateCommandAction({ type: "terminal.command", ...command, cwd }),
      requestId,
    );
  }
  localFileContext(actor: TaskActor, taskId: string) {
    if (actor.kind !== "human") throw Error("HUMAN_APPROVAL_REQUIRED");
    const context = this.fileContext(actor, taskId),
      task = this.owned(actor, taskId);
    return {
      ...context,
      hostId: task.view.hostId,
      hostName: task.view.hostName,
      state: task.view.state,
      title: task.view.title,
    };
  }
  fileObservationContext(actor: TaskActor, taskId: string) {
    const task = this.owned(actor, taskId);
    if (
      actor.kind === "mcp" &&
      (actor.connectionId !== task.connectionId ||
        !this.clients.has(actor.connectionId))
    )
      throw Error("CLIENT_CONNECTION_CHANGED");
    const control = task.session.control.snapshot();
    return {
      userId: task.userId,
      taskId: task.view.id,
      sessionId: task.view.sessionId,
      control: {
        generation: control.generation,
        controlEpoch: control.controlEpoch,
      },
    };
  }
  fileContext(actor: TaskActor, taskId: string) {
    const context = this.fileObservationContext(actor, taskId),
      task = this.owned(actor, taskId);
    this.sessionFor(actor, task.view.sessionId);
    if (actor.kind !== "human") {
      if (
        !task.lease ||
        terminalState(task.view.state) ||
        !task.deadline ||
        Date.now() >= task.deadline
      )
        throw Error("TASK_NOT_RUNNING");
      task.session.control.assertLease(task.lease);
    }
    return context;
  }
  hasOperationRequest(actor: TaskActor, taskId: string, requestId: string) {
    const task = this.owned(actor, taskId);
    return task.operationIds.some(
      (id) => task.gateway.get(id).context.requestId === requestId,
    );
  }
  async submitFile(
    actor: TaskActor,
    taskId: string,
    action: FileAction,
    requestId: string,
  ): Promise<TaskView> {
    const task = this.owned(actor, taskId);
    if (!task.session.files) throw new Error("FILE_EXECUTOR_UNAVAILABLE");
    return this.submitAction(
      actor,
      taskId,
      validateFileAction(action),
      requestId,
    );
  }
  reserveDirectory(actor: TaskActor, taskId: string): object {
    this.fileContext(actor, taskId);
    const t = this.owned(actor, taskId);
    if (
      t.directoryReservation ||
      t.steps.length ||
      t.attachingWorkflow ||
      t.activeWorkflowRunId ||
      t.submitting ||
      t.view.state !== "ready"
    )
      throw Error("DIRECTORY_IN_PROGRESS");
    if (
      this.pendingReconciliation(t) ||
      t.operationIds.some((id) =>
        ["proposed", "queued", "running", "awaiting-approval"].includes(
          t.gateway.get(id).status,
        ),
      )
    )
      throw Error("RECONCILIATION_REQUIRED");
    const token = Object.freeze({ id: randomUUID() });
    t.directoryReservation = token;
    return token;
  }
  releaseDirectory(taskId: string, token: object) {
    const t = this.tasks.get(taskId);
    if (t?.directoryReservation === token) {
      t.directoryReservation = undefined;
      this.progress(t);
    }
  }
  submitDirectory(
    actor: TaskActor,
    taskId: string,
    action: import("../../../types/directory-transfer.js").DirectoryAction,
    requestId: string,
    token: object,
  ) {
    const t = this.owned(actor, taskId);
    if (t.directoryReservation !== token) throw Error("DIRECTORY_IN_PROGRESS");
    return this.submitOperation(
      actor,
      taskId,
      validateFileAction(action),
      requestId,
      token,
    );
  }
  private requestOperation(task: RecordTask, requestId: string) {
    const id = task.operationRequests.get(requestId);
    return id ? task.gateway.get(id) : undefined;
  }
  private hasPendingOperation(task: RecordTask) {
    for (const id of task.pendingOperations) {
      if (
        ["proposed", "awaiting-approval", "queued", "running"].includes(
          task.gateway.get(id).status,
        )
      )
        return true;
      task.pendingOperations.delete(id);
    }
    return false;
  }
  private async submitAction(
    actor: TaskActor,
    taskId: string,
    action: OperationAction,
    requestId: string,
  ): Promise<TaskView> {
    await this.submitOperation(actor, taskId, action, requestId);
    return this.view(this.owned(actor, taskId));
  }
  private async submitOperation(
    actor: TaskActor,
    taskId: string,
    action: OperationAction,
    requestId: string,
    reservation?: object,
  ): Promise<OperationView> {
    const task = this.owned(actor, taskId);
    if (task.directoryReservation && task.directoryReservation !== reservation)
      throw Error("DIRECTORY_IN_PROGRESS");
    if (
      actor.kind === "mcp" &&
      (actor.connectionId !== task.connectionId ||
        !this.clients.has(actor.connectionId))
    )
      throw new Error("CLIENT_CONNECTION_CHANGED");
    if (task.steps.length || task.attachingWorkflow || task.activeWorkflowRunId)
      throw new Error("WORKFLOW_PLAN_IMMUTABLE");
    const previous = this.requestOperation(task, requestId);
    if (previous) {
      if (JSON.stringify(action) !== JSON.stringify(previous.action))
        throw new Error("REQUEST_CONFLICT");
      return previous;
    }
    if (
      task.submitting ||
      task.view.state === "running" ||
      this.hasPendingOperation(task)
    )
      throw new Error("OPERATION_IN_PROGRESS");
    const version = task.generation;
    task.submitting = true;
    let op: OperationView;
    try {
      op = await this.propose(task, action, requestId);
    } finally {
      task.submitting = false;
    }
    if (version !== task.generation) throw new Error("STALE_CONTROL");
    void this.dispatch(task, op.id, version).catch((error) => {
      if (version !== task.generation) return;
      if (error.message === "APPROVAL_REQUIRED")
        task.view.state = "awaiting-approval";
      else this.pause(task, error.message);
      this.progress(task);
    });
    return task.gateway.get(op.id);
  }
  async approve(
    actor: TaskActor,
    taskId: string,
    operationId: string,
    digest: string,
    revision: number,
    fileReviewId?: string,
    viewOptions?: TaskViewOptions,
  ): Promise<TaskView> {
    this.human(actor);
    const task = this.owned(actor, taskId);
    if (
      !task.operationIds.includes(operationId) ||
      task.view.state !== "awaiting-approval"
    )
      throw new Error("STALE_APPROVAL");
    const operation = task.gateway.get(operationId);
    if (
      operation.action.type === "file.write" &&
      !this.ports.fileReviewValid?.(
        actor.userId,
        taskId,
        operationId,
        operation.action.proposalId,
        digest,
        revision,
        {
          generation: task.session.control.snapshot().generation,
          controlEpoch: task.session.control.snapshot().controlEpoch,
        },
        fileReviewId,
      )
    )
      throw Error("FILE_REVIEW_REQUIRED");
    const approvalVersion = task.generation;
    try {
      await this.ports.audit(actor.userId).record("operation.approval", {
        taskId,
        operationId,
        digest,
        policyRevision: revision,
        userId: actor.userId,
      });
    } catch {
      this.pause(task, "AUDIT_UNAVAILABLE");
      throw new Error("AUDIT_UNAVAILABLE");
    }
    if (
      approvalVersion !== task.generation ||
      task.view.state !== "awaiting-approval"
    )
      throw new Error("STALE_APPROVAL");
    if (
      operation.action.type === "file.write" &&
      !this.ports.fileReviewValid?.(
        actor.userId,
        taskId,
        operationId,
        operation.action.proposalId,
        digest,
        revision,
        {
          generation: task.session.control.snapshot().generation,
          controlEpoch: task.session.control.snapshot().controlEpoch,
        },
        fileReviewId,
      )
    )
      throw Error("FILE_REVIEW_REQUIRED");
    task.gateway.approveOnce(operationId, digest, revision);
    task.view.state = "ready";
    if (task.steps.length) void this.pump(task, task.generation);
    else {
      const version = task.generation;
      void this.dispatch(task, operationId, version).catch((error) => {
        if (version === task.generation) this.pause(task, error.message);
      });
    }
    return this.view(task, viewOptions);
  }
  takeover(actor: TaskActor, sessionId: string): void {
    this.human(actor);
    this.sessionFor(actor, sessionId).control.takeover();
  }
  cancel(
    actor: TaskActor,
    taskId: string,
    viewOptions?: TaskViewOptions,
  ): TaskView {
    const task = this.owned(actor, taskId);
    if (task.archiving) throw Error("TASK_ARCHIVE_IN_PROGRESS");
    task.generation++;
    task.view.state = "cancelled";
    this.closeDirectorySteps(task);
    this.recordCancellation(task, "USER_CANCELLED");
    if (task.activeWorkflowRunId)
      task.workflowRuns.get(task.activeWorkflowRunId)!.summary.endedAt =
        Date.now();
    this.notify(task);
    task.probe?.dispose();
    this.returnControl(task);
    return this.view(task, viewOptions);
  }
  async finish(
    actor: TaskActor,
    taskId: string,
    viewOptions?: TaskViewOptions,
  ): Promise<TaskView> {
    const task = this.owned(actor, taskId);
    if (["completed", "completed-with-errors"].includes(task.view.state)) {
      await this.persistRecovery(task);
      return this.view(task, viewOptions);
    }
    if (
      task.directoryReservation ||
      task.steps.length ||
      task.attachingWorkflow ||
      task.view.state !== "ready" ||
      task.operationIds.some((id) => {
        const op = task.gateway.get(id);
        return (
          op.auditGap ||
          (!["succeeded", "cancelled-before-send"].includes(op.status) &&
            !task.reviews.has(op.id) &&
            !task.continuedFailures.has(op.id)) ||
          (op.status === "succeeded" && !!op.error)
        );
      })
    )
      throw new Error("TASK_NOT_COMPLETE");
    if (
      actor.kind === "mcp" &&
      (actor.connectionId !== task.connectionId ||
        !this.clients.has(actor.connectionId))
    )
      throw new Error("CLIENT_DISCONNECTED");
    const version = task.generation;
    await this.ports.audit(task.userId).record("task.completed", { taskId });
    if (task.generation !== version || task.view.state !== "ready")
      throw new Error("STALE_CONTROL");
    task.view.state = task.view.hasFailures
      ? "completed-with-errors"
      : "completed";
    this.returnControl(task);
    await this.persistRecovery(task);
    return this.view(task, viewOptions);
  }
  async archive(
    actor: TaskActor,
    taskId: string,
    release: () => Promise<void>,
  ) {
    this.human(actor);
    const task = this.owned(actor, taskId);
    if (task.archiving) throw Error("TASK_ARCHIVE_IN_PROGRESS");
    if (!terminalState(task.view.state)) throw Error("TASK_NOT_COMPLETE");
    if (task.operationIds.some((id) => !task.gateway.canDiscard(id)))
      throw Error("TASK_ARCHIVE_RECONCILIATION_REQUIRED");
    task.archiving = true;
    const metadata = {
      taskId,
      sessionId: task.view.sessionId,
      hostId: task.view.hostId,
      hostName: task.view.hostName,
      title: task.view.title,
      source: task.view.source,
      mode: task.view.mode,
      state: task.view.state,
      error: task.view.error,
      createdAt: task.view.createdAt,
      operationCount: task.operationIds.length,
    };
    try {
      await this.ports
        .audit(task.userId)
        .record("task.archive-requested", metadata);
      await release();
      await this.ports.audit(task.userId).record("task.archived", metadata);
      this.closeDirectorySteps(task);
      task.unsubscribe?.();
      task.unsubscribe = undefined;
      task.gateway.dispose();
      task.listeners.clear();
      task.progressListeners.clear();
      this.archived.set(taskId, {
        userId: task.userId,
        hostId: task.view.hostId,
        clientId: task.clientId,
        agentRunId: task.agentRunId,
      });
      this.tasks.delete(taskId);
      return { id: taskId, archived: true };
    } finally {
      task.archiving = false;
    }
  }
  private recordCancellation(task: RecordTask, reason: string) {
    void this.ports
      .audit(task.userId)
      .record("task.cancelled", {
        taskId: task.view.id,
        title: task.view.title,
        hostId: task.view.hostId,
        hostName: task.view.hostName,
        state: "cancelled",
        reason,
      })
      .catch(() => {
        task.view.error = "AUDIT_UNAVAILABLE";
      });
  }
  private returnControl(task: RecordTask): void {
    if (task.lease) {
      try {
        task.session.control.assertLease(task.lease);
        task.session.control.takeover();
      } catch {
        /* preserve newer ownership */
      }
    }
  }
  private pause(task: RecordTask, code: string): void {
    task.view.error = code;
    task.view.state = "paused-error";
    task.generation++;
    this.notify(task);
    this.returnControl(task);
  }
  private pendingReconciliation(task: RecordTask): OperationView | undefined {
    for (let i = task.operationIds.length - 1; i >= 0; i--) {
      const id = task.operationIds[i];
      if (
        !task.reviews.has(id) &&
        !task.continuedFailures.has(id) &&
        ["unknown", "failed"].includes(task.gateway.status(id))
      )
        return task.gateway.get(id);
    }
  }
  operationDetail(actor: TaskActor, taskId: string, id: string): TaskOperation {
    const task = this.owned(actor, taskId);
    if (!task.operationIds.includes(id)) throw Error("OPERATION_NOT_FOUND");
    return this.projectOperation(task, id);
  }
  private projectOperation(
    task: RecordTask,
    id: string,
    outputLimit?: number,
  ): TaskOperation {
    const op = task.gateway.get(id),
      output = redact(op.output) as string | undefined;
    return {
      id: op.id,
      requestId: op.context.requestId,
      digest: op.digest,
      action: op.action,
      fileResult: op.fileResult,
      decision: op.decision,
      status: op.status,
      output:
        outputLimit === undefined ? output : output?.slice(0, outputLimit),
      ...(outputLimit !== undefined && (output?.length ?? 0) > outputLimit
        ? { outputTruncated: true }
        : {}),
      error: op.error,
      exitCode: op.exitCode,
      resultingCwd: op.resultingCwd,
      auditGap: op.auditGap,
      startedAt: op.startedAt,
      endedAt: op.endedAt,
      timedOut: op.timedOut,
      interruptionRequested: op.interruptionRequested,
      workflowRunId: task.operationWorkflows.get(id),
      reviewed: task.reviews.get(id),
    };
  }
  private view(task: RecordTask, options?: TaskViewOptions): TaskView {
    if (
      options &&
      (!Number.isInteger(options.operationLimit) ||
        options.operationLimit < 0 ||
        options.operationLimit > 100 ||
        (options.operationOffset !== undefined &&
          (!Number.isInteger(options.operationOffset) ||
            options.operationOffset < 0)))
    )
      throw Error("INVALID_REQUEST");
    const total = task.operationIds.length,
      summary = options?.operationLimit === 0;
    const {
      commands: _commands,
      plan: _plan,
      fileBindings: _fileBindings,
      ...metadata
    } = task.view;
    const base = summary
      ? structuredClone({
          ...metadata,
          title: metadata.title.slice(0, 512),
          commands: [],
        })
      : structuredClone(task.view);
    let offset =
      options?.operationOffset === undefined
        ? options?.operationLimit
          ? Math.max(
              0,
              Math.floor((total - 1) / options.operationLimit) *
                options.operationLimit,
            )
          : 0
        : Math.min(total, options.operationOffset);
    const operations: TaskOperation[] = [];
    let bytes = 2;
    if (!summary) {
      const end = options
        ? Math.min(total, offset + options.operationLimit)
        : total;
      const backwards = options?.operationOffset === undefined && !!options;
      for (
        let i = backwards ? end - 1 : offset;
        backwards ? i >= offset : i < end;
        backwards ? i-- : i++
      ) {
        const op = this.projectOperation(
            task,
            task.operationIds[i],
            options ? 8000 : undefined,
          ),
          size = options ? Buffer.byteLength(JSON.stringify(op)) + 1 : 0;
        if (options && size > 1024 * 1024)
          throw Error("TASK_OPERATION_TOO_LARGE");
        if (options && bytes + size > 1024 * 1024) {
          if (backwards) offset = i + 1;
          break;
        }
        bytes += size;
        if (backwards) operations.unshift(op);
        else operations.push(op);
      }
    }
    const stepId = task.steps[task.view.nextStep]?.operationId;
    return {
      ...base,
      canArchive:
        terminalState(task.view.state) &&
        task.operationIds.every((id) => task.gateway.canDiscard(id)),
      activeWorkflowRunId: task.activeWorkflowRunId,
      workflowRuns: summary
        ? []
        : [...task.workflowRuns.keys()].map((id) =>
            this.workflowSummary(task, id, !!options),
          ),
      reconciliationRequired:
        task.recoveryDecisionRequired ||
        (task.steps.length
          ? !!stepId &&
            ["unknown", "failed"].includes(task.gateway.status(stepId))
          : !!this.pendingReconciliation(task)),
      control: task.session.control.snapshot(),
      policyRevision: task.policy.revision,
      operations,
      ...(options
        ? {
            operationPage: {
              offset,
              total,
              succeeded: task.operationIds.reduce(
                (n, id) =>
                  n + (task.gateway.status(id) === "succeeded" ? 1 : 0),
                0,
              ),
              previousOffset:
                offset > 0
                  ? Math.max(0, offset - options.operationLimit)
                  : null,
              nextOffset:
                !summary && offset + operations.length < total
                  ? offset + operations.length
                  : null,
              latest: total
                ? task.gateway.getSummary(task.operationIds[total - 1])
                : undefined,
            },
          }
        : {}),
    };
  }
}
