import { isDirectoryAction } from "@/types/directory-transfer";
import { TaskDirectoryTransfers } from "./TaskDirectoryTransfers";
import { DirectoryTransferManifest } from "./DirectoryTransferManifest";
import { TaskAuthorizationForm } from "./TaskAuthorizationForm";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import { TaskLocalFiles } from "./TaskLocalFiles";
import { FileTransferResult } from "./FileTransferResult";
import { FileInspectionResult } from "./FileInspectionResult";
import { FileOperationReview } from "./FileOperationReview";
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
  const [operationPage, setOperationPage] = useState<number | null>(null);
  const [directoryActive, setDirectoryActive] = useState<{
    taskId: string;
    active: boolean;
  }>();
  const [localGrants, setLocalGrants] = useState<{
    taskId: string;
    grants: HumanLocalFileGrant[];
  }>();
  const [composing, setComposing] = useState(!focusTaskId);
  useEffect(() => {
    if (focusTaskId) {
      setSelected(focusTaskId);
      setComposing(false);
    }
  }, [focusTaskId]);
  const [composer, setComposer] = useState<
    "workflow" | "assistant" | "directory"
  >("workflow");
  const [title, setTitle] = useState("");
  const [plan, setPlan] = useState("pwd\ndf -h\nuptime");
  const [mode, setMode] = useState<TaskMode>("collaborative");
  const [formError, setFormError] = useState("");
  const tasks = work.snapshot?.tasks ?? [];
  const task = tasks.find((item) => item.id === selected) ?? tasks.at(-1);
  const latestOperationPage = Math.max(
    0,
    Math.ceil((task?.operations.length ?? 0) / 50) - 1,
  );
  const operationOffset =
    Math.min(operationPage ?? latestOperationPage, latestOperationPage) * 50;
  useEffect(() => {
    setOperationPage(null);
  }, [task?.id]);
  const clearActionError = work.clearActionError;
  useEffect(() => {
    clearActionError();
  }, [task?.id, composing, clearActionError]);
  const agent = work.snapshot?.agents?.find((run) => run.taskId === task?.id);
  const session = work.snapshot?.session;
  const control = session?.control;
  const ownsAutomation = control?.controller.kind === "automation";
  const create = async () => {
    setFormError("");
    try {
      const commands =
        composer === "directory" ? undefined : parseCommandPlan(plan);
      const created = await work.run(() =>
        collaborationApi.create({
          sessionId,
          requestId: crypto.randomUUID(),
          title:
            title.trim() ||
            t(
              composer === "directory"
                ? "tandem.directoryTask.title"
                : "tandem.collaboration.defaultTitle",
            ),
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
            <Button
              size="sm"
              variant={composer === "directory" ? "default" : "outline"}
              onClick={() => setComposer("directory")}
            >
              {t("tandem.directoryTask.title")}
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
            {composer !== "directory" && (
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
            )}
            <p className="tandem-task-help">
              {t(
                composer === "directory"
                  ? "tandem.directoryTask.createHint"
                  : "tandem.collaboration.planHint",
              )}
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
                    : t(
                        task.stepCount
                          ? "tandem.collaboration.workflow"
                          : "tandem.directoryTask.title",
                      )}
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
              onGrantsChange={(grants) =>
                setLocalGrants({ taskId: task.id, grants })
              }
              disabled={finished(task) || !session?.connected}
            />
            {(task.stepCount === 0 ||
              task.operations.some((op) => isDirectoryAction(op.action))) && (
              <TaskDirectoryTransfers
                key={"directories:" + task.id}
                taskId={task.id}
                grants={
                  localGrants?.taskId === task.id ? localGrants.grants : []
                }
                onActiveChange={(active) =>
                  setDirectoryActive({ taskId: task.id, active })
                }
                operationVersion={[
                  task.operations.at(-1)?.id,
                  task.operations.at(-1)?.status,
                  task.operations.at(-1)?.auditGap,
                  task.state,
                ].join(":")}
                ready={task.state === "ready"}
                disabled={
                  finished(task) || !session?.connected || task.stepCount > 0
                }
                onChange={() => {
                  void work.run(() => Promise.resolve(task));
                }}
              />
            )}
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
                localGrants={
                  localGrants?.taskId === task.id ? localGrants.grants : []
                }
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
            {task.operations.length > 50 && (
              <nav
                className="flex flex-wrap items-center gap-2 text-xs"
                aria-label={t("tandem.directoryTask.operationPages")}
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={operationOffset === 0}
                  onClick={() => setOperationPage(operationOffset / 50 - 1)}
                >
                  {t("tandem.directoryTask.previous")}
                </Button>
                <span>
                  {t("tandem.directoryTask.page", {
                    from: operationOffset + 1,
                    to: Math.min(operationOffset + 50, task.operations.length),
                    total: task.operations.length,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={operationOffset / 50 >= latestOperationPage}
                  onClick={() => setOperationPage(operationOffset / 50 + 1)}
                >
                  {t("tandem.directoryTask.next")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOperationPage(null)}
                >
                  {t("tandem.directoryTask.latest")}
                </Button>
              </nav>
            )}
            {task.operations
              .slice(operationOffset, operationOffset + 50)
              .map((op, index) => (
                <OperationCard
                  key={op.id}
                  workflowName={
                    task.workflowRuns?.find(
                      (run) => run.id === op.workflowRunId,
                    )?.name
                  }
                  taskId={task.id}
                  operation={op}
                  localGrant={
                    localGrants?.taskId === task.id &&
                    "localGrantId" in op.action
                      ? localGrants.grants.find(
                          (g) =>
                            g.id ===
                              (op.action as { localGrantId: string })
                                .localGrantId &&
                            g.version ===
                              (op.action as { localVersion: string })
                                .localVersion,
                        )
                      : undefined
                  }
                  index={operationOffset + index}
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
            {task.stepCount === 0 && task.state === "ready" && (
              <Button
                variant="outline"
                disabled={
                  work.busy ||
                  (directoryActive?.taskId === task.id &&
                    directoryActive.active)
                }
                onClick={() =>
                  void work.run(() => collaborationApi.finish(task.id))
                }
              >
                {t("tandem.directoryTask.finish")}
              </Button>
            )}
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
function OperationCard({
  taskId,
  operation: op,
  workflowName,
  localGrant,
  index,
  canApprove,
  disabled,
  onApprove,
}: {
  taskId: string;
  operation: TaskOperation;
  workflowName?: string;
  localGrant?: HumanLocalFileGrant;
  index: number;
  canApprove: boolean;
  disabled: boolean;
  onApprove: (fileReviewId?: string) => void;
}) {
  const { t } = useTranslation();
  const [directoryReviewed, setDirectoryReviewed] = useState(false);
  const directoryAction = isDirectoryAction(op.action);
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
      {(op.action.type === "file.upload" ||
        op.action.type === "file.download" ||
        directoryAction) && (
        <p className="select-text break-all text-xs">
          {t(
            op.action.type === "file.upload" ||
              (isDirectoryAction(op.action) && op.action.direction === "upload")
              ? "tandem.transfer.localSource"
              : "tandem.transfer.localTarget",
          )}
          : {localGrant?.path ?? t("tandem.transfer.localUnavailable")}
        </p>
      )}
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
          {op.fileResult.directoryTransfer && (
            <p className="text-xs">
              {t("tandem.directoryTask.summary", {
                ...op.fileResult.directoryTransfer,
              })}
            </p>
          )}
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
      {op.action.type === "file.directory.confirm" &&
        op.action.stopOnConflict && (
          <p className="text-xs">
            {t("tandem.workflow.directoryConflictStop")}
          </p>
        )}
      {op.action.type === "file.directory.confirm" && (
        <DirectoryTransferManifest
          key={op.id}
          taskId={taskId}
          previewId={op.action.previewId}
          choices={op.action.choices}
          onReview={
            canApprove
              ? (state) => setDirectoryReviewed(state.ready)
              : undefined
          }
        />
      )}
      {canApprove && op.action.type !== "file.write" && (
        <Button
          disabled={
            disabled ||
            ((op.action.type === "file.upload" ||
              op.action.type === "file.download" ||
              directoryAction) &&
              localGrant?.state !== "active") ||
            (op.action.type === "file.directory.confirm" && !directoryReviewed)
          }
          onClick={() => onApprove()}
        >
          <Check size={14} />
          {t("tandem.collaboration.approveOnce")}
        </Button>
      )}
    </article>
  );
}
