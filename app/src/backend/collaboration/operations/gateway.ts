import { validateFileResult } from "./file-result.js";
import type {
  FileAction,
  FileScope,
  FileExecutionResult,
  FileResultView,
} from "../../../types/file-operations.js";
import {
  validateFileAction,
  evaluateFilePolicy,
  fileScopeAllows,
  fileScopeSchema,
} from "../policies/file-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { ControlLease } from "../../../types/collaboration.js";
import type {
  CommandAction,
  OperationAction,
  CommandDecision,
  CommandMatch,
  CommandPolicySnapshot,
  PolicyTarget,
} from "../../../types/collaboration-operations.js";
import { SessionControl } from "../sessions/control.js";
import {
  evaluateCommandPolicy,
  matchesCommand,
  validateCommandAction,
} from "../policies/command-policy.js";

export type OperationStatus =
  | "proposed"
  | "awaiting-approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled-before-send"
  | "unknown";
export interface OperationContext {
  taskId: string;
  requestId: string;
  mode: "collaborative" | "automatic";
  origin: "agent" | "workflow" | "mcp" | "command-panel";
  lease: ControlLease;
}
export interface OperationView {
  id: string;
  digest: string;
  context: OperationContext;
  action: OperationAction;
  fileResult?: FileResultView;
  decision: CommandDecision;
  status: OperationStatus;
  output?: string;
  outputTruncated?: boolean;
  resultingCwd?: string;
  exitCode?: number | null;
  error?: string;
  auditGap?: boolean;
  timedOut?: boolean;
  interruptionRequested?: boolean;
  startedAt?: number;
  endedAt?: number;
}
export interface PreparedCommand {
  bytes: Uint8Array;
  // The adapter installs its output observer during preparation. Preparation
  // itself must neither execute a command nor create another SSH connection.
  completion: Promise<{
    exitCode: number | null;
    output: string;
    cwd?: string;
    truncated?: boolean;
    timedOut?: boolean;
  }>;
  beforeSend?(): void;
  dispose(): void;
}
export interface FileOperationGuard {
  (canonicalPath?: string): void;
  canListEntry?(requestedPath: string, canonicalPath: string): boolean;
}
export interface PreparedFileOperation {
  // Preparation must not read or mutate a remote file. Execution uses only the
  // authenticated session. Call guard with the resolved path before I/O, then
  // again before every subsequent read, write or commit; never enqueue behind it.
  execute(guard: FileOperationGuard): Promise<FileExecutionResult>;
  dispose(): void;
}
export interface FileExecutorPort {
  prepare(
    action: FileAction,
    operationId: string,
    context: OperationContext,
  ): Promise<PreparedFileOperation>;
}
export interface CommandExecutorPort {
  prepare(action: CommandAction, operationId: string): Promise<PreparedCommand>;
}
export interface OperationAuditPort {
  append(event: { type: string; operation: OperationView }): Promise<void>;
}
interface Approval {
  digest: string;
  revision: number;
  expiresAt: number;
}
interface StoredOperation {
  view: OperationView;
  approval?: Approval;
  dispatched?: Promise<OperationView>;
  prepared?: PreparedCommand | PreparedFileOperation;
  resolvedPath?: string;
  chargedGrant?: TaskGrant;
  interrupted?: boolean;
}
interface TaskGrant {
  taskId: string;
  lease: ControlLease;
  revision: number;
  matches: CommandMatch[];
  fileScopes: FileScope[];
  cwdScopes: string[];
  expiresAt: number;
  remaining: number;
}
export class GatewayError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GatewayError";
  }
}
const leaseKey = (lease: ControlLease) =>
  JSON.stringify([
    lease.sessionId,
    lease.generation,
    lease.controlEpoch,
    lease.ownerType,
    lease.ownerId,
  ]);
const isFinal = (status: OperationStatus) =>
  ["succeeded", "failed", "cancelled-before-send", "unknown"].includes(status);

/** Session-bound authority shared by AI, workflow and MCP adapters. Human-only
 * grant/approval methods must be exposed only by authenticated UI handlers. */
export class OperationGateway {
  private readonly operations = new Map<string, StoredOperation>();
  private readonly requests = new Map<string, string>();
  private readonly grants = new Map<string, TaskGrant>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly target: () => Omit<PolicyTarget, "taskId">;

  constructor(
    private readonly control: SessionControl,
    target: Omit<PolicyTarget, "taskId"> | (() => Omit<PolicyTarget, "taskId">),
    private readonly policy: () => CommandPolicySnapshot,
    private readonly executor: CommandExecutorPort,
    private readonly audit: OperationAuditPort,
    private readonly now: () => number = Date.now,
    private readonly assertTaskAuthority?: (
      context: OperationContext,
      action: OperationAction,
    ) => void,
    private readonly fileExecutor?: FileExecutorPort,
  ) {
    const fixed =
      typeof target === "function" ? undefined : structuredClone(target);
    this.target = typeof target === "function" ? target : () => fixed!;
    const unsubscribe = control.subscribe(() => {
      this.tail = Promise.resolve();
      for (const operation of this.operations.values()) {
        if (isFinal(operation.view.status)) continue;
        try {
          control.assertLease(operation.view.context.lease);
        } catch {
          operation.interrupted = operation.view.status === "running";
          operation.view.error = "STALE_CONTROL";
          operation.view.status =
            operation.view.status === "running"
              ? "unknown"
              : "cancelled-before-send";
          operation.prepared?.dispose();
        }
      }
      if (control.snapshot().closed) unsubscribe();
    });
  }

  async propose(
    context: OperationContext,
    input: OperationAction,
  ): Promise<OperationView> {
    const action =
      input?.type === "terminal.command"
        ? validateCommandAction(input)
        : validateFileAction(input as FileAction);
    if (
      !context ||
      typeof context.taskId !== "string" ||
      !context.taskId ||
      context.taskId.length > 128 ||
      typeof context.requestId !== "string" ||
      !context.requestId ||
      context.requestId.length > 128 ||
      !["collaborative", "automatic"].includes(context.mode) ||
      !["agent", "workflow", "mcp", "command-panel"].includes(context.origin) ||
      !context.lease
    )
      throw new GatewayError("INVALID_CONTEXT");
    const frozenContext = structuredClone(context);
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          frozenContext.taskId,
          frozenContext.mode,
          frozenContext.origin,
          leaseKey(frozenContext.lease),
          action,
        ]),
      )
      .digest("hex");
    const requestKey = JSON.stringify([context.taskId, context.requestId]);
    const existingId = this.requests.get(requestKey);
    if (existingId) {
      const existing = this.required(existingId);
      if (existing.view.digest !== digest)
        throw new GatewayError("REQUEST_CONFLICT");
      return structuredClone(existing.view);
    }
    this.control.assertLease(context.lease);
    if (this.operations.size >= 512)
      throw new GatewayError("SESSION_OPERATION_LIMIT");
    const decision = this.evaluate(
      this.policy(),
      { ...this.target(), taskId: context.taskId },
      action,
    );
    const view: OperationView = {
      id: randomUUID(),
      digest,
      context: frozenContext,
      action,
      decision,
      status: "proposed",
    };
    const operation = { view };
    this.operations.set(view.id, operation);
    this.requests.set(requestKey, view.id);
    try {
      await this.audit.append({
        type: "operation.proposed",
        operation: structuredClone(view),
      });
    } catch {
      view.auditGap = true;
      view.status = "failed";
      view.error = "AUDIT_UNAVAILABLE";
      this.pauseOwnLease(view.context.lease);
      throw new GatewayError("AUDIT_UNAVAILABLE");
    }
    return structuredClone(view);
  }

  get(id: string): OperationView {
    return structuredClone(this.required(id).view);
  }

  /** Trusted human action; not a tool exposed to a model or MCP. */
  approveOnce(
    id: string,
    expectedDigest: string,
    expectedPolicyRevision: number,
  ): void {
    const operation = this.required(id);
    const view = operation.view;
    if (
      view.digest !== expectedDigest ||
      isFinal(view.status) ||
      view.status === "running"
    )
      throw new GatewayError("STALE_APPROVAL");
    this.control.assertLease(view.context.lease);
    if (expectedPolicyRevision !== this.policy().revision)
      throw new GatewayError("POLICY_CHANGED");
    view.decision = this.evaluate(
      this.policy(),
      { ...this.target(), taskId: view.context.taskId },
      view.action,
    );
    if (view.decision.outcome === "deny")
      throw new GatewayError("POLICY_DENIED");
    operation.approval = {
      digest: view.digest,
      revision: view.decision.revision,
      expiresAt: this.now() + 5 * 60_000,
    };
  }

  /** Trusted human action, bound to one task and the current control epoch. */
  authorizeTask(
    taskId: string,
    lease: ControlLease,
    scope: {
      matches: CommandMatch[];
      fileScopes?: FileScope[];
      cwdScopes: string[];
      maxOperations: number;
      expiresAt: number;
      expectedPolicyRevision: number;
    },
  ): void {
    this.control.assertLease(lease);
    if (scope.expectedPolicyRevision !== this.policy().revision)
      throw new GatewayError("POLICY_CHANGED");
    if (
      !taskId ||
      (!scope.matches.length && !scope.fileScopes?.length) ||
      (scope.fileScopes?.length ?? 0) > 128 ||
      (scope.fileScopes ?? []).some(
        (item) => !fileScopeSchema.safeParse(item).success,
      ) ||
      !scope.cwdScopes.length ||
      scope.cwdScopes.some(
        (cwd) =>
          typeof cwd !== "string" || !cwd.startsWith("/") || cwd.includes("\0"),
      ) ||
      !Number.isInteger(scope.maxOperations) ||
      scope.maxOperations < 1 ||
      scope.maxOperations > 500 ||
      !Number.isFinite(scope.expiresAt) ||
      scope.expiresAt <= this.now() ||
      scope.expiresAt > this.now() + 8 * 60 * 60_000
    )
      throw new GatewayError("INVALID_TASK_GRANT");
    if (this.grants.size >= 128 && !this.grants.has(taskId))
      throw new GatewayError("SESSION_GRANT_LIMIT");
    this.grants.set(taskId, {
      taskId,
      lease: structuredClone(lease),
      revision: this.policy().revision,
      matches: structuredClone(scope.matches),
      fileScopes: structuredClone(scope.fileScopes ?? []),
      cwdScopes: scope.cwdScopes.map((cwd) => posix.normalize(cwd)),
      expiresAt: scope.expiresAt,
      remaining: scope.maxOperations,
    });
  }

  dispatch(id: string): Promise<OperationView> {
    const operation = this.required(id);
    if (operation.dispatched) return operation.dispatched;
    if (isFinal(operation.view.status)) return Promise.resolve(this.get(id));
    try {
      this.authority(operation);
    } catch (error) {
      operation.view.status = "awaiting-approval";
      return Promise.reject(error);
    }
    operation.view.status = "queued";
    operation.dispatched = this.tail.then(() => this.run(operation));
    this.tail = operation.dispatched.catch(() => {});
    return operation.dispatched;
  }

  private evaluate(
    snapshot: CommandPolicySnapshot,
    target: PolicyTarget,
    action: OperationAction,
  ): CommandDecision {
    return action.type === "terminal.command"
      ? evaluateCommandPolicy(snapshot, target, action)
      : evaluateFilePolicy(snapshot, target, action);
  }

  private authority(operation: StoredOperation): TaskGrant | undefined {
    const view = operation.view;
    this.control.assertLease(view.context.lease);
    this.assertTaskAuthority?.(view.context, view.action);
    view.decision = this.evaluate(
      this.policy(),
      { ...this.target(), taskId: view.context.taskId },
      view.action,
    );
    if (view.decision.outcome === "deny")
      throw new GatewayError("POLICY_DENIED");
    const effectiveAction =
      view.action.type === "terminal.command" || !operation.resolvedPath
        ? view.action
        : { ...view.action, canonicalPath: operation.resolvedPath };
    if (effectiveAction !== view.action) {
      const resolvedDecision = this.evaluate(
        this.policy(),
        { ...this.target(), taskId: view.context.taskId },
        effectiveAction,
      );
      view.decision = resolvedDecision;
      if (resolvedDecision.outcome === "deny")
        throw new GatewayError("POLICY_DENIED");
    }
    const fileGrant =
      view.action.type === "terminal.command"
        ? undefined
        : this.grants.get(view.context.taskId);
    if (view.action.type !== "terminal.command") {
      if (
        !fileGrant ||
        fileGrant.revision !== view.decision.revision ||
        leaseKey(fileGrant.lease) !== leaseKey(view.context.lease) ||
        fileGrant.expiresAt <= this.now() ||
        (fileGrant.remaining <= 0 && operation.chargedGrant !== fileGrant)
      )
        throw new GatewayError("FILE_SCOPE_REQUIRED");
      if (!fileScopeAllows(fileGrant.fileScopes, effectiveAction as FileAction))
        throw new GatewayError("FILE_SCOPE_EXCEEDED");
    }
    const approval = operation.approval;
    if (
      approval &&
      approval.digest === view.digest &&
      approval.revision === view.decision.revision &&
      approval.expiresAt > this.now()
    )
      return fileGrant;
    // Cooperative mode always confirms each immutable action. A broad task
    // grant also cannot silently approve an opaque shell/interpreter request.
    if (
      view.context.mode === "collaborative" ||
      view.decision.outcome === "unknown"
    )
      throw new GatewayError("APPROVAL_REQUIRED");
    const grant = this.grants.get(view.context.taskId);
    if (fileGrant) return fileGrant;
    if (view.action.type !== "terminal.command")
      throw new GatewayError("FILE_SCOPE_REQUIRED");
    const commandAction = view.action;
    const cwd = posix.normalize(commandAction.cwd);
    if (
      !grant ||
      grant.revision !== view.decision.revision ||
      leaseKey(grant.lease) !== leaseKey(view.context.lease) ||
      grant.expiresAt <= this.now() ||
      grant.remaining <= 0 ||
      !grant.matches.some((match) => matchesCommand(match, commandAction)) ||
      !grant.cwdScopes.some(
        (scope) =>
          cwd === scope ||
          cwd.startsWith(scope === "/" ? "/" : scope.replace(/\/$/, "") + "/"),
      )
    )
      throw new GatewayError("APPROVAL_REQUIRED");
    return grant;
  }

  private async run(operation: StoredOperation): Promise<OperationView> {
    const view = operation.view;
    let prepared: PreparedCommand | PreparedFileOperation | undefined;
    let sent = false;
    try {
      this.authority(operation);
      if (view.action.type === "terminal.command")
        prepared = await this.executor.prepare(
          structuredClone(view.action),
          view.id,
        );
      else {
        if (!this.fileExecutor)
          throw new GatewayError("FILE_EXECUTOR_UNAVAILABLE");
        prepared = await this.fileExecutor.prepare(
          structuredClone(view.action),
          view.id,
          structuredClone(view.context),
        );
      }
      operation.prepared = prepared;
      // A disposed preparation may reject its observer; always attach a
      // rejection handler even when takeover prevents the corresponding write.
      if ("completion" in prepared) void prepared.completion.catch(() => {});
      try {
        await this.audit.append({
          type: "operation.intent",
          operation: structuredClone(view),
        });
      } catch {
        view.auditGap = true;
        this.pauseOwnLease(view.context.lease);
        throw new GatewayError("AUDIT_UNAVAILABLE");
      }
      const grant = this.authority(operation);
      if (view.action.type !== "terminal.command") {
        const file = prepared as PreparedFileOperation;
        if (grant) {
          grant.remaining--;
          operation.chargedGrant = grant;
        }
        sent = true;
        view.status = "running";
        view.startedAt = this.now();
        let expired = false,
          timer: ReturnType<typeof setTimeout> | undefined;
        const guard: FileOperationGuard = (canonicalPath?: string) => {
          if (expired || operation.interrupted)
            throw new GatewayError("STALE_CONTROL");
          if (canonicalPath !== undefined) {
            if (
              !canonicalPath.startsWith("/") ||
              /[\x00-\x1f\x7f]/.test(canonicalPath)
            )
              throw new GatewayError("INVALID_FILE_ACTION");
            if (
              view.action.type === "file.write" &&
              posix.normalize(canonicalPath) !==
                posix.normalize(view.action.canonicalPath)
            )
              throw new GatewayError("FILE_TARGET_CHANGED");
            if (
              operation.resolvedPath &&
              operation.resolvedPath !== posix.normalize(canonicalPath)
            )
              throw new GatewayError("FILE_TARGET_CHANGED");
            operation.resolvedPath = posix.normalize(canonicalPath);
          }
          this.authority(operation);
        };
        guard.canListEntry = (requestedPath, canonicalPath) => {
          guard();
          if (
            view.action.type !== "file.list" ||
            !operation.resolvedPath ||
            posix.dirname(requestedPath) !==
              posix.normalize(view.action.path) ||
            posix.dirname(canonicalPath) !== operation.resolvedPath
          )
            throw new GatewayError("INVALID_FILE_ACTION");
          const child = validateFileAction({
            type: "file.stat",
            path: requestedPath,
            canonicalPath,
          });
          const entryGrant = this.grants.get(view.context.taskId);
          return (
            !!entryGrant &&
            fileScopeAllows(entryGrant.fileScopes, child) &&
            this.evaluate(
              this.policy(),
              { ...this.target(), taskId: view.context.taskId },
              child,
            ).outcome !== "deny"
          );
        };
        try {
          guard();
          const execution = file.execute(guard);
          const timeout = new Promise<FileExecutionResult>((resolve) => {
            timer = setTimeout(() => {
              expired = true;
              view.timedOut = true;
              this.pauseOwnLease(view.context.lease);
              resolve({ status: "unknown", error: "FILE_OPERATION_TIMEOUT" });
            }, view.action.timeoutMs ?? 120000);
          });
          const result = validateFileResult(
            await Promise.race([execution, timeout]),
            view.action,
            operation.resolvedPath,
          );
          if (!["succeeded", "failed", "unknown"].includes(result.status))
            throw new GatewayError("INVALID_FILE_RESULT");
          if (result.status === "succeeded" && !operation.resolvedPath)
            throw new GatewayError("FILE_TARGET_UNVERIFIED");
          view.fileResult = result.result
            ? structuredClone(result.result)
            : undefined;
          view.status = operation.interrupted ? "unknown" : result.status;
          view.error = view.timedOut
            ? "FILE_OPERATION_TIMEOUT"
            : operation.interrupted
              ? "STALE_CONTROL"
              : result.error;
          if (view.status === "unknown") {
            view.error ??= "RESULT_UNKNOWN";
            this.pauseOwnLease(view.context.lease);
          }
        } finally {
          expired = true;
          if (timer) clearTimeout(timer);
        }
      } else {
        const command = prepared as PreparedCommand;
        command.beforeSend?.();
        if (grant) grant.remaining--;
        // No await between the final authority check and the existing stream's
        // synchronous write. A false stream.write return is backpressure, not failure.
        this.control.commitWrite(view.context.lease, command.bytes);
        sent = true;
        view.status = "running";
        view.startedAt = this.now();
        const result = await command.completion;
        if (result.timedOut) {
          view.timedOut = true;
          try {
            this.control.assertLease(view.context.lease);
            this.control.commitWrite(view.context.lease, Uint8Array.of(3));
            view.interruptionRequested = true;
          } catch {
            /* A newer owner must never receive this timeout interrupt. */
          }
        }
        view.exitCode = operation.interrupted ? null : result.exitCode;
        view.output = result.output.slice(0, 256_000);
        view.outputTruncated =
          !!result.truncated || result.output.length > 256_000;
        view.resultingCwd = result.cwd;
        view.status =
          operation.interrupted || result.exitCode === null
            ? "unknown"
            : result.exitCode === 0
              ? "succeeded"
              : "failed";
        if (view.status === "unknown") {
          view.error = "RESULT_UNKNOWN";
          this.pauseOwnLease(view.context.lease);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OPERATION_FAILED";
      const code =
        view.action.type === "terminal.command" ||
        /^[A-Z][A-Z0-9_]{1,80}$/.test(message)
          ? message
          : "FILE_OPERATION_FAILED";
      view.error = code;
      view.status =
        sent || code === "RESULT_UNKNOWN" ? "unknown" : "cancelled-before-send";
      if (view.status === "unknown") this.pauseOwnLease(view.context.lease);
    } finally {
      try {
        prepared?.dispose();
      } catch {
        view.error ??= "CLEANUP_FAILED";
        this.pauseOwnLease(view.context.lease);
      }
    }
    view.endedAt = this.now();
    try {
      await this.audit.append({
        type: "operation.completed",
        operation: structuredClone(view),
      });
    } catch {
      view.auditGap = true;
      this.pauseOwnLease(view.context.lease);
    }
    return structuredClone(view);
  }

  private required(id: string): StoredOperation {
    const operation = this.operations.get(id);
    if (!operation) throw new GatewayError("OPERATION_NOT_FOUND");
    return operation;
  }

  private pauseOwnLease(lease: ControlLease): void {
    try {
      this.control.assertLease(lease);
      this.control.takeover();
    } catch {
      /* Never revoke a newer task's lease. */
    }
  }
}
