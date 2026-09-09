import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { Button } from "@/components/button";
import type { TaskView } from "@/types/collaboration-task";
import type { FileScope } from "@/types/file-operations";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import { isTaskFileStep, type TaskFileBindings } from "@/types/task-plan";
import { TaskPlanLine } from "./TaskPlanLine";
import { TaskWorkflowFiles } from "./TaskWorkflowFiles";
import { workflowBindingsReady } from "./workflow-file-bindings";
import { FileScopeEditor } from "./FileScopes";
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
  const [fileScopes, setFileScopes] = useState<FileScope[]>([]);
  const [directory, setDirectory] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [budget, setBudget] = useState(
    Math.max(
      task.stepCount,
      task.plan?.some(
        (s) => isTaskFileStep(s) && s.kind === "directory-transfer",
      )
        ? 100
        : 10,
    ),
  );
  const [minutes, setMinutes] = useState(15);
  const [allowedPrograms, setAllowedPrograms] = useState("pwd\ndf\nuptime");
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
  return (
    <form
      className="tandem-authorization"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bindingsReady) return;
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
          matches:
            task.stepCount && !task.activeWorkflowRunId
              ? undefined
              : allowedPrograms
                  .split(/\r?\n/)
                  .map((program) => program.trim())
                  .filter(Boolean)
                  .map((program) => ({ kind: "program" as const, program })),
          fileScopes: fileScopes.length ? fileScopes : undefined,
          fileBindings: Object.keys(fileBindings).length
            ? fileBindings
            : undefined,
          reconciliation: reconciliation || undefined,
        });
      }}
    >
      <h4>{t("tandem.collaboration.authorization")}</h4>
      {plan.length > 0 && (
        <ol className="tandem-plan-review">
          {plan.map((cmd, i) => (
            <li key={i}>
              <TaskPlanLine step={cmd} />
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
            onChange={(e) => setAllowedPrograms(e.target.value)}
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
              const access = step.direction === "upload" ? "write" : "read",
                found = scopes.find(
                  (s) =>
                    s.kind ===
                      (step.kind === "directory-transfer"
                        ? "directory"
                        : "path") && s.path === step.path,
                );
              if (found) {
                if (!found.access.includes(access)) found.access.push(access);
              } else
                scopes.push({
                  kind:
                    step.kind === "directory-transfer" ? "directory" : "path",
                  path: step.path,
                  access: [access],
                });
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
            max={5000}
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
    </form>
  );
}
