import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/button";
import type { TaskView } from "@/types/collaboration-task";
import type { FileScope } from "@/types/file-operations";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import { isTaskFileStep, type TaskFileBindings } from "@/types/task-plan";
import { TaskPlanLine } from "./TaskPlanLine";
import { TaskWorkflowFiles } from "./TaskWorkflowFiles";
import { workflowBindingsReady } from "./workflow-file-bindings";
import { FileScopeEditor } from "./FileScopes";

const DEFAULT_AI_PROGRAMS = [
  "pwd",
  "df",
  "du",
  "free",
  "uptime",
  "uname",
  "whoami",
  "hostname",
  "id",
  "ps",
  "ss",
  "netstat",
  "lsblk",
  "date",
  "lscpu",
  "vmstat",
  "iostat",
  "docker",
] as const;

export function TaskAuthorizationForm({
  task,
  localGrants,
  disabled,
  revision,
  onAuthorize,
}: {
  task: TaskView;
  localGrants: HumanLocalFileGrant[];
  disabled: boolean;
  revision: number;
  onAuthorize: (
    scope: import("@/types/collaboration-task").TaskAuthorization,
  ) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [advanced, setAdvanced] = useState(task.source !== "assistant");
  const [fileScopes, setFileScopes] = useState<FileScope[]>([]);
  const [directory, setDirectory] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [budget, setBudget] = useState(
    Math.max(
      task.stepCount,
      task.plan?.some(
        (step) => isTaskFileStep(step) && step.kind === "directory-transfer",
      )
        ? 100
        : 10,
    ),
  );
  const [minutes, setMinutes] = useState(15);
  const [allowedPrograms, setAllowedPrograms] = useState(
    task.source === "assistant"
      ? DEFAULT_AI_PROGRAMS.join("\n")
      : "pwd\ndf\nuptime",
  );
  const [reconciliation, setReconciliation] = useState<"retry" | "skip" | "">(
    "",
  );
  const plan = task.plan ?? task.commands;
  const [fileBindings, setFileBindings] = useState<TaskFileBindings>(
    task.fileBindings ?? {},
  );
  const remainingFiles = plan
    .slice(
      task.nextStep +
        (task.reconciliationRequired && reconciliation === "skip" ? 1 : 0),
    )
    .filter(isTaskFileStep);
  const bindingsReady = workflowBindingsReady(
    task.id,
    remainingFiles,
    fileBindings,
    localGrants,
  );
  const needsReconcile = !!task.reconciliationRequired;
  const quickAuthorization =
    task.source === "assistant" &&
    task.stepCount === 0 &&
    !needsReconcile &&
    remainingFiles.length === 0 &&
    !advanced;

  function authorize(shellReady: boolean) {
    if (!bindingsReady) return;
    void onAuthorize({
      planRevision: task.planRevision ?? 0,
      generation: task.control.generation,
      controlEpoch: task.control.controlEpoch,
      policyRevision: revision,
      shellReady,
      directory: directory.trim() || undefined,
      maxOperations: budget,
      durationMinutes: minutes,
      allowReviewedPlan: reviewed,
      allowReadOnlyAutoRun: task.source === "assistant",
      matches:
        task.stepCount && !task.activeWorkflowRunId
          ? undefined
          : allowedPrograms
              .split(/\r?\n/)
              .map((program) => program.trim())
              .filter(Boolean)
              .map((program) => ({ kind: "program" as const, program })),
      fileScopes: fileScopes.length ? fileScopes : undefined,
      fileBindings: Object.keys(fileBindings).length ? fileBindings : undefined,
      reconciliation: reconciliation || undefined,
    });
  }

  return (
    <form
      className="tandem-authorization"
      onSubmit={(event) => {
        event.preventDefault();
        authorize(quickAuthorization || ready);
      }}
    >
      {!quickAuthorization && (
        <h4>{t("tandem.collaboration.authorization")}</h4>
      )}

      {quickAuthorization ? (
        <section className="tandem-ai-authorization-card">
          <div className="tandem-ai-authorization-heading">
            <span aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            <div>
              <strong>{t("tandem.collaboration.quickAuthorizeTitle")}</strong>
              <p>
                {t("tandem.collaboration.quickAuthorizeHint", {
                  programs: DEFAULT_AI_PROGRAMS.length,
                  count: budget,
                  minutes,
                })}
              </p>
            </div>
          </div>

          <Button
            type="submit"
            className="tandem-next-primary"
            disabled={disabled || !bindingsReady}
          >
            <Play size={14} />
            {t("tandem.collaboration.quickAuthorize")}
          </Button>

          <details className="tandem-authorization-details">
            <summary>{t("tandem.collaboration.authorizationDetails")}</summary>
            <div className="tandem-authorization-details-body">
              <div
                className="tandem-ai-programs"
                aria-label={t("tandem.collaboration.allowedPrograms")}
              >
                {DEFAULT_AI_PROGRAMS.map((program) => (
                  <code key={program}>{program}</code>
                ))}
              </div>
              <p className="tandem-task-help">
                {t("tandem.collaboration.quickAuthorizePolicy")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setAdvanced(true)}
              >
                <SlidersHorizontal size={14} />
                {t("tandem.collaboration.adjustScope")}
              </Button>
            </div>
          </details>
        </section>
      ) : (
        <>
          {plan.length > 0 && (
            <ol className="tandem-plan-review">
              {plan.map((command, index) => (
                <li key={index}>
                  <TaskPlanLine step={command} />
                </li>
              ))}
            </ol>
          )}

          {(task.stepCount === 0 || !!task.activeWorkflowRunId) && (
            <p className="tandem-task-help">
              {t("tandem.collaboration.externalScope")}
            </p>
          )}

          {(task.stepCount === 0 || !!task.activeWorkflowRunId) && (
            <label>
              {t("tandem.collaboration.allowedPrograms")}
              <textarea
                value={allowedPrograms}
                onChange={(event) => setAllowedPrograms(event.target.value)}
                rows={4}
                maxLength={4096}
                required={task.stepCount === 0 && !fileScopes.length}
              />
            </label>
          )}

          {task.activeWorkflowRunId && (
            <p className="tandem-task-help">{t("taskRecovery.parentScope")}</p>
          )}

          <TaskWorkflowFiles
            taskId={task.id}
            steps={remainingFiles}
            value={fileBindings}
            grants={localGrants}
            onChange={setFileBindings}
            disabled={disabled}
          />

          {remainingFiles.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                const scopes = structuredClone(fileScopes);
                for (const step of remainingFiles) {
                  const access = step.direction === "upload" ? "write" : "read";
                  const found = scopes.find(
                    (scope) =>
                      scope.kind ===
                        (step.kind === "directory-transfer"
                          ? "directory"
                          : "path") && scope.path === step.path,
                  );
                  if (found) {
                    if (!found.access.includes(access)) {
                      found.access.push(access);
                    }
                  } else {
                    scopes.push({
                      kind:
                        step.kind === "directory-transfer"
                          ? "directory"
                          : "path",
                      path: step.path,
                      access: [access],
                    });
                  }
                }
                setFileScopes(scopes);
              }}
            >
              {t("tandem.workflow.addPlannedFileScopes")}
            </Button>
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
              onChange={(event) => setDirectory(event.target.value)}
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
                max={5000}
                required
                value={budget}
                onChange={(event) => setBudget(event.target.valueAsNumber)}
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
                onChange={(event) => setMinutes(event.target.valueAsNumber)}
              />
            </label>
          </div>

          <label className="tandem-task-checkbox">
            <input
              type="checkbox"
              checked={ready}
              onChange={(event) => setReady(event.target.checked)}
            />
            <span>{t("tandem.collaboration.shellReady")}</span>
          </label>

          {task.mode === "automatic" && task.commands.length > 0 && (
            <label className="tandem-task-checkbox">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
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
                onChange={(event) =>
                  setReconciliation(event.target.value as "retry" | "skip")
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
            disabled={
              disabled ||
              !ready ||
              !bindingsReady ||
              (needsReconcile && !reconciliation)
            }
          >
            <Play size={14} />
            {t("tandem.collaboration.authorize")}
          </Button>
        </>
      )}
    </form>
  );
}
