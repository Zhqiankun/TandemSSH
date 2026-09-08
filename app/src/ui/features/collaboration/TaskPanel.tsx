import { TaskLocalFiles } from "./TaskLocalFiles";
import { FileTransferResult } from "./FileTransferResult";
import { FileInspectionResult } from "./FileInspectionResult";
import { FileOperationReview } from "./FileOperationReview";
import { FileScopeEditor } from "./FileScopes";
import type { FileScope } from "@/types/file-operations";
import { useState, useEffect, lazy, Suspense } from "react";
import { WorkflowRuns } from "./WorkflowRuns";
import { McpSettings } from "@/features/mcp/McpSettings";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Check, Hand, Play, Square, X } from "lucide-react";
import { Button } from "@/components/button";
import { collaborationApi } from "@/api/collaboration-api";
import type {
  TaskMode,
  TaskOperation,
  TaskView,
} from "@/types/collaboration-task";
import {
  CommandPlanError,
  displayCommand,
  parseCommandPlan,
} from "./command-plan";
import { useTaskWorkbench } from "./use-task-workbench";
import "./task-panel.css";
const WorkflowLibrary = lazy(() =>
  import("@/features/workflows/WorkflowLibrary").then((module) => ({
    default: module.WorkflowLibrary,
  })),
);
const PolicySettings = lazy(() =>
  import("./PolicySettings").then((module) => ({
    default: module.PolicySettings,
  })),
);
const AiTaskComposer = lazy(() =>
  import("@/features/ai/tasks/AiTaskComposer").then((module) => ({
    default: module.AiTaskComposer,
  })),
);
const AiTaskTranscript = lazy(() =>
  import("@/features/ai/tasks/AiTaskTranscript").then((module) => ({
    default: module.AiTaskTranscript,
  })),
);
const resumable = (task: TaskView) =>
  ["awaiting-authorization", "paused-human", "paused-error"].includes(
    task.state,
  );
const finished = (task: TaskView) =>
  ["completed", "completed-with-errors", "cancelled"].includes(task.state);
export function TaskPanel({
  sessionId,
  onClose,
  focusTaskId,
}: {
  sessionId: string;
  onClose: () => void;
  focusTaskId?: string;
}) {
  const { t } = useTranslation();
  const work = useTaskWorkbench(sessionId);
  const [selected, setSelected] = useState<string>();
  const [composing, setComposing] = useState(!focusTaskId);
  useEffect(() => {
    if (focusTaskId) {
      setSelected(focusTaskId);
      setComposing(false);
    }
  }, [focusTaskId]);
  const [composer, setComposer] = useState<"workflow" | "assistant">(
    "workflow",
  );
  const [title, setTitle] = useState("");
  const [plan, setPlan] = useState("pwd\ndf -h\nuptime");
  const [mode, setMode] = useState<TaskMode>("collaborative");
  const [formError, setFormError] = useState("");
  const tasks = work.snapshot?.tasks ?? [];
  const task = tasks.find((item) => item.id === selected) ?? tasks.at(-1);
  const agent = work.snapshot?.agents?.find((run) => run.taskId === task?.id);
  const session = work.snapshot?.session;
  const control = session?.control;
  const ownsAutomation = control?.controller.kind === "automation";
  const create = async () => {
    setFormError("");
    try {
      const commands = parseCommandPlan(plan);
      const created = await work.run(() =>
        collaborationApi.create({
          sessionId,
          requestId: crypto.randomUUID(),
          title: title.trim() || t("tandem.collaboration.defaultTitle"),
          mode,
          commands,
        }),
      );
      if (created) {
        setSelected(created.id);
        setComposing(false);
      }
    } catch (error) {
      if (error instanceof CommandPlanError)
        setFormError(
          t("tandem.collaboration.parseError", {
            line: error.line,
            reason: t("tandem.collaboration.parse." + error.reason),
          }),
        );
      else setFormError(t("tandem.collaboration.errors.INVALID_REQUEST"));
    }
  };
  return (
    <aside
      className="tandem-task-panel"
      aria-label={t("tandem.collaboration.title")}
    >
      <header className="tandem-task-heading">
        <div>
          <div className="tandem-task-eyebrow">TANDEM / SSH</div>
          <h2>
            <ArrowLeftRight size={16} />
            {t("tandem.collaboration.title")}
          </h2>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          aria-label={t("tandem.collaboration.close")}
        >
          <X size={17} />
        </Button>
      </header>
      <div className="tandem-control-strip">
        <span
          className={
            ownsAutomation ? "tandem-status-dot active" : "tandem-status-dot"
          }
        />
        <span>
          {!session?.connected
            ? t("tandem.collaboration.disconnected")
            : ownsAutomation
              ? t("tandem.collaboration.automationControl")
              : t("tandem.collaboration.humanControl")}
        </span>
        <Button
          size="sm"
          variant={ownsAutomation ? "default" : "outline"}
          disabled={!session?.connected || work.takeoverPending}
          onClick={() => void work.takeover()}
        >
          <Hand size={14} />
          {t("tandem.collaboration.takeover")}
        </Button>
      </div>
      {work.error && (
        <p role="alert" className="tandem-task-error">
          {t("tandem.collaboration.errors." + work.error, {
            defaultValue: t("tandem.collaboration.errors.CONNECTION_FAILED"),
          })}
        </p>
      )}
      <div className="tandem-task-scroll">
        <p className="tandem-task-help">
          {t("tandem.collaboration.sharedHint")}
        </p>
        {tasks.length > 0 && (
          <div className="tandem-task-picker">
            <label>
              <span className="sr-only">
                {t("tandem.collaboration.chooseTask")}
              </span>
              <select
                value={composing ? "" : (task?.id ?? "")}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setComposing(false);
                }}
              >
                <option value="" disabled>
                  {t("tandem.collaboration.chooseTask")}
                </option>
                {tasks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComposing(true)}
            >
              {t("tandem.collaboration.newTask")}
            </Button>
          </div>
        )}
        {composing && (
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              variant={composer === "workflow" ? "default" : "outline"}
              onClick={() => setComposer("workflow")}
            >
              {t("tandem.collaboration.workflow")}
            </Button>
            <Button
              size="sm"
              variant={composer === "assistant" ? "default" : "outline"}
              onClick={() => setComposer("assistant")}
            >
              {t("tandem.agent.task")}
            </Button>
          </div>
        )}
        {composing && composer === "assistant" ? (
          <Suspense fallback={<p>{t("tandem.agent.loading")}</p>}>
            <AiTaskComposer
              sessionId={sessionId}
              onCreate={async (action) => {
                const created = await work.run(action);
                if (created) {
                  setSelected(created.id);
                  setComposing(false);
                }
              }}
            />
          </Suspense>
        ) : composing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="tandem-task-form"
          >
            <label>
              {t("tandem.collaboration.taskName")}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder={t("tandem.collaboration.defaultTitle")}
              />
            </label>
            <fieldset className="tandem-mode-select">
              <legend>{t("tandem.collaboration.mode")}</legend>
              {(["collaborative", "automatic"] as const).map((value) => (
                <label key={value} className={mode === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="task-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <strong>{t("tandem.collaboration.modes." + value)}</strong>
                  <small>{t("tandem.collaboration.modeHints." + value)}</small>
                </label>
              ))}
            </fieldset>
            <label>
              {t("tandem.collaboration.commandPlan")}
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                rows={8}
                maxLength={100_000}
                spellCheck={false}
                autoCapitalize="off"
              />
            </label>
            <p className="tandem-task-help">
              {t("tandem.collaboration.planHint")}
            </p>
            {formError && (
              <p role="alert" className="tandem-task-error">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={work.busy || !session?.connected}>
              <Play size={14} />
              {t("tandem.collaboration.reviewPlan")}
            </Button>
          </form>
        ) : task ? (
          <div className="tandem-task-details">
            <div className="tandem-task-title">
              <h3>{task.title}</h3>
              <span className={"tandem-task-state " + task.state}>
                {t("tandem.collaboration.states." + task.state)}
              </span>
            </div>
            <div className="tandem-task-meta">
              <span>{t("tandem.collaboration.modes." + task.mode)}</span>
              <span>
                {task.source === "mcp"
                  ? "MCP"
                  : task.source === "assistant"
                    ? "AI"
                    : t("tandem.collaboration.workflow")}
              </span>
              <span>
                {task.stepCount
                  ? t("tandem.collaboration.progress", {
                      done: task.nextStep,
                      total: task.stepCount,
                    })
                  : t("tandem.collaboration.operationProgress", {
                      done: task.operations.filter(
                        (op) => op.status === "succeeded",
                      ).length,
                      total: task.operations.length,
                    })}
              </span>
            </div>
            {task.cwd && (
              <p className="tandem-task-directory" title={task.cwd}>
                {task.cwd}
              </p>
            )}
            {task.error && (
              <p role="alert" className="tandem-task-error">
                {t("tandem.collaboration.errors." + task.error, {
                  defaultValue: t(
                    "tandem.collaboration.errors.TASK_REQUEST_FAILED",
                  ),
                })}
              </p>
            )}
            {!!task.workflowRuns?.length && (
              <WorkflowRuns runs={task.workflowRuns} parentState={task.state} />
            )}
            {agent && (
              <Suspense fallback={null}>
                <AiTaskTranscript run={agent} />
              </Suspense>
            )}
            <TaskLocalFiles
              key={task.id}
              taskId={task.id}
              disabled={finished(task) || !session?.connected}
            />
            {resumable(task) && (
              <TaskAuthorizationForm
                key={
                  task.id +
                  ":" +
                  task.control.controlEpoch +
                  ":" +
                  task.state +
                  ":" +
                  (task.planRevision ?? 0)
                }
                task={task}
                disabled={
                  work.busy ||
                  !session?.connected ||
                  ownsAutomation ||
                  (task.source === "assistant" &&
                    (!agent || agent.phase === "planning"))
                }
                revision={work.snapshot?.policy.revision ?? task.policyRevision}
                onAuthorize={(scope) =>
                  work.run(() => collaborationApi.authorize(task.id, scope))
                }
              />
            )}
            {task.operations.map((op, index) => (
              <OperationCard
                key={op.id}
                workflowName={
                  task.workflowRuns?.find((run) => run.id === op.workflowRunId)
                    ?.name
                }
                taskId={task.id}
                operation={op}
                index={index}
                canApprove={
                  task.state === "awaiting-approval" &&
                  op.status === "awaiting-approval" &&
                  op.decision.outcome !== "deny"
                }
                disabled={work.busy}
                onApprove={(fileReviewId) =>
                  void work.run(() =>
                    collaborationApi.approve(task.id, {
                      operationId: op.id,
                      digest: op.digest,
                      policyRevision: task.policyRevision,
                      fileReviewId,
                    }),
                  )
                }
              />
            ))}
            {!finished(task) && (
              <Button
                variant="outline"
                disabled={work.busy}
                onClick={() =>
                  void work.run(() => collaborationApi.cancel(task.id))
                }
              >
                <Square size={12} />
                {t("tandem.collaboration.cancel")}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center gap-2 justify-between">
        <span>{t("tandem.collaboration.recordingHint")}</span>
        <Suspense fallback={null}>
          <WorkflowLibrary
            sessionId={sessionId}
            hostId={session?.hostId}
            connected={!!session?.connected}
            onCreated={(created) => {
              void work.run(async () => created);
              setSelected(created.id);
              setComposing(false);
            }}
          />
          <PolicySettings
            sessionId={sessionId}
            hostId={session?.hostId}
            taskId={task?.id}
          />
        </Suspense>
        <McpSettings hostId={session?.hostId} />
      </footer>
    </aside>
  );
}
function TaskAuthorizationForm({
  task,
  disabled,
  revision,
  onAuthorize,
}: {
  task: TaskView;
  disabled: boolean;
  revision: number;
  onAuthorize: (
    scope: import("@/types/collaboration-task").TaskAuthorization,
  ) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [fileScopes, setFileScopes] = useState<FileScope[]>([]);
  const [directory, setDirectory] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [budget, setBudget] = useState(Math.max(task.stepCount, 10));
  const [minutes, setMinutes] = useState(15);
  const [allowedPrograms, setAllowedPrograms] = useState("pwd\ndf\nuptime");
  const [reconciliation, setReconciliation] = useState<"retry" | "skip" | "">(
    "",
  );
  const needsReconcile = !!task.reconciliationRequired;
  return (
    <form
      className="tandem-authorization"
      onSubmit={(e) => {
        e.preventDefault();
        void onAuthorize({
          planRevision: task.planRevision ?? 0,
          generation: task.control.generation,
          controlEpoch: task.control.controlEpoch,
          policyRevision: revision,
          shellReady: ready,
          directory: directory.trim() || undefined,
          maxOperations: budget,
          durationMinutes: minutes,
          allowReviewedPlan: reviewed,
          matches: task.stepCount
            ? undefined
            : allowedPrograms
                .split(/\r?\n/)
                .map((program) => program.trim())
                .filter(Boolean)
                .map((program) => ({ kind: "program" as const, program })),
          fileScopes: fileScopes.length ? fileScopes : undefined,
          reconciliation: reconciliation || undefined,
        });
      }}
    >
      <h4>{t("tandem.collaboration.authorization")}</h4>
      {task.commands.length > 0 && (
        <ol className="tandem-plan-review">
          {task.commands.map((cmd, i) => (
            <li key={i}>
              <code>{displayCommand(cmd)}</code>
              {cmd.cwd && <small>{cmd.cwd}</small>}
            </li>
          ))}
        </ol>
      )}
      {task.stepCount === 0 && (
        <p className="tandem-task-help">
          {t("tandem.collaboration.externalScope")}
        </p>
      )}
      {task.stepCount === 0 && (
        <label>
          {t("tandem.collaboration.allowedPrograms")}
          <textarea
            value={allowedPrograms}
            onChange={(e) => setAllowedPrograms(e.target.value)}
            rows={4}
            maxLength={4096}
            required={!fileScopes.length}
          />
        </label>
      )}
      <FileScopeEditor
        value={fileScopes}
        onChange={setFileScopes}
        disabled={disabled}
      />
      <label>
        {t("tandem.collaboration.directory")}
        <input
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          placeholder={t("tandem.collaboration.currentDirectory")}
          pattern="/.*"
        />
      </label>
      <div className="tandem-task-limits">
        <label>
          {t("tandem.collaboration.maxOperations")}
          <input
            type="number"
            min={1}
            max={500}
            required
            value={budget}
            onChange={(e) => setBudget(e.target.valueAsNumber)}
          />
        </label>
        <label>
          {t("tandem.collaboration.duration")}
          <input
            type="number"
            min={1}
            max={480}
            required
            value={minutes}
            onChange={(e) => setMinutes(e.target.valueAsNumber)}
          />
        </label>
      </div>
      <label className="tandem-task-checkbox">
        <input
          type="checkbox"
          checked={ready}
          onChange={(e) => setReady(e.target.checked)}
        />
        <span>{t("tandem.collaboration.shellReady")}</span>
      </label>
      {task.mode === "automatic" && task.commands.length > 0 && (
        <label className="tandem-task-checkbox">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          <span>{t("tandem.collaboration.reviewedPlan")}</span>
        </label>
      )}
      {needsReconcile && (
        <label>
          {t("tandem.collaboration.reconcile")}
          <select
            required
            value={reconciliation}
            onChange={(e) =>
              setReconciliation(e.target.value as "retry" | "skip")
            }
          >
            <option value="" disabled>
              {t("tandem.collaboration.reconcileChoose")}
            </option>
            <option value="skip">{t("tandem.collaboration.skip")}</option>
            <option value="retry">{t("tandem.collaboration.retry")}</option>
          </select>
        </label>
      )}
      <Button
        type="submit"
        disabled={disabled || !ready || (needsReconcile && !reconciliation)}
      >
        <Play size={14} />
        {t("tandem.collaboration.authorize")}
      </Button>
    </form>
  );
}
function OperationCard({
  taskId,
  operation: op,
  workflowName,
  index,
  canApprove,
  disabled,
  onApprove,
}: {
  taskId: string;
  operation: TaskOperation;
  workflowName?: string;
  index: number;
  canApprove: boolean;
  disabled: boolean;
  onApprove: (fileReviewId?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className={"tandem-operation " + op.status}>
      <div className="tandem-operation-heading">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>{t("tandem.collaboration.operations." + op.status)}</strong>
        {op.exitCode !== undefined && op.exitCode !== null && (
          <small>
            {t("tandem.collaboration.exitCode", { code: op.exitCode })}
          </small>
        )}
      </div>
      {workflowName && (
        <small>{t("tandem.workflow.fromRun", { name: workflowName })}</small>
      )}
      <code className="tandem-operation-command">
        {op.action.type === "terminal.command"
          ? displayCommand(op.action)
          : t(
              "tandem.collaboration.fileActions." +
                op.action.type.replace("file.", ""),
            ) +
            " " +
            op.action.path}
      </code>
      <small className="tandem-task-directory">
        {op.action.type === "terminal.command"
          ? op.action.cwd
          : op.action.canonicalPath}
      </small>
      {op.decision.matchedRules.length > 0 && (
        <small>
          {t("tandem.collaboration.rules")}:{" "}
          {op.decision.matchedRules.join(", ")}
        </small>
      )}
      {op.status === "unknown" && !op.reviewed && (
        <p className="tandem-task-error">
          {t(
            op.action.type === "terminal.command"
              ? "tandem.collaboration.unknownHint"
              : "tandem.fileScope.unknownResult",
          )}
        </p>
      )}
      {op.reviewed && (
        <p className="text-[10px] text-muted-foreground">
          {t("tandem.agent.reviewed")}
        </p>
      )}
      {op.auditGap && (
        <p role="alert" className="tandem-task-error">
          {t("tandem.collaboration.errors.AUDIT_UNAVAILABLE")}
        </p>
      )}
      {op.fileResult && (
        <div className="tandem-file-operation-result">
          <FileInspectionResult result={op.fileResult} />
          {op.fileResult.transfer && (
            <FileTransferResult result={op.fileResult.transfer} />
          )}
          {op.fileResult.document && (
            <small className="tandem-task-directory">
              {op.fileResult.document.canonicalPath}
            </small>
          )}
          {op.fileResult.bytes !== undefined && !op.fileResult.transfer && (
            <small>
              {t("tandem.fileScope.bytes", { bytes: op.fileResult.bytes })}
            </small>
          )}
          {op.fileResult.temporaryPath && (
            <p>
              {t("fileDocument.temporary")}{" "}
              <code>{op.fileResult.temporaryPath}</code>
            </p>
          )}
          {op.fileResult.commitMayHaveOccurred && (
            <p>{t("fileDocument.unknownCommit")}</p>
          )}
        </div>
      )}
      {op.output && (
        <details open={index === 0}>
          <summary>{t("tandem.collaboration.output")}</summary>
          <pre>{op.output}</pre>
        </details>
      )}
      {op.action.type === "file.write" && (
        <FileOperationReview
          taskId={taskId}
          operation={op}
          canApprove={canApprove}
          disabled={disabled}
          onApprove={onApprove}
        />
      )}
      {canApprove && op.action.type !== "file.write" && (
        <Button disabled={disabled} onClick={() => onApprove()}>
          <Check size={14} />
          {t("tandem.collaboration.approveOnce")}
        </Button>
      )}
    </article>
  );
}
