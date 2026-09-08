import { useTranslation } from "react-i18next";
import { isTaskFileStep, type TaskPlanStep } from "@/types/task-plan";
import { displayCommand } from "@/features/collaboration/command-plan";
export function TaskPlanLine({ step }: { step: TaskPlanStep }) {
  const { t } = useTranslation();
  return isTaskFileStep(step) ? (
    <>
      <code>
        {t(
          step.kind === "directory-transfer"
            ? "tandem.directoryTask.direction." + step.direction
            : "tandem.collaboration.fileActions." + step.direction,
        )}{" "}
        {step.path}
      </code>
      <small>
        {t("tandem.workflow.localFileSlot")}: {step.localFile} ·{" "}
        {t(
          step.overwrite
            ? "tandem.localFiles.mayOverwrite"
            : "tandem.localFiles.noOverwrite",
        )}
      </small>
      {step.kind === "directory-transfer" && (
        <small>
          {t("tandem.workflow.directoryConflict")}:{" "}
          {t(
            "tandem.workflow.directoryConflicts." + (step.onConflict ?? "fail"),
          )}
        </small>
      )}
    </>
  ) : (
    <>
      <code>{displayCommand(step)}</code>
      {step.cwd && <small>{step.cwd}</small>}
    </>
  );
}
