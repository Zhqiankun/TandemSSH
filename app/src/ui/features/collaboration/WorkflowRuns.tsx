import { useTranslation } from "react-i18next";
import type { TaskWorkflowRun, TaskState } from "@/types/collaboration-task";
export function WorkflowRuns({
  runs,
  parentState,
}: {
  runs: TaskWorkflowRun[];
  parentState: TaskState;
}) {
  const { t } = useTranslation();
  return (
    <div className="tandem-workflow-runs">
      {runs.map((run) => (
        <section key={run.id} className="tandem-parent-workflow">
          <div className="tandem-task-title">
            <h4>{t("tandem.workflow.fromRun", { name: run.name })}</h4>
            <span className={"tandem-task-state " + run.state}>
              {t("tandem.collaboration.states." + run.state)}
            </span>
          </div>
          {run.restoredFromTaskId && (
            <p className="tandem-task-help">
              {t("taskRecovery.parentRestored")}
            </p>
          )}
          <small>
            {t("tandem.workflow.runRevision", {
              version: run.workflow.version,
              revision: run.workflow.revision,
            })}{" "}
            · {run.nextStep} / {run.stepCount}
          </small>
          {run.state.startsWith("completed") &&
            ["ready", "running", "awaiting-approval"].includes(parentState) && (
              <p className="tandem-task-help">
                {t("tandem.workflow.parentContinues")}
              </p>
            )}
        </section>
      ))}
    </div>
  );
}
