import { useTranslation } from "react-i18next";
import { isTaskFileStep, type TaskPlanStep } from "@/types/task-plan";
import { displayCommand } from "@/features/collaboration/command-plan";
export function TaskPlanLine({ step }: { step: TaskPlanStep }) {
  const { t } = useTranslation();
  return isTaskFileStep(step) ? (
    <>
      <code>
        {t("tandem.collaboration.fileActions." + step.direction)} {step.path}
      </code>
      <small>
        {t("tandem.workflow.localFileSlot")}: {step.localFile} ·{" "}
        {t(
          step.overwrite
            ? "tandem.localFiles.mayOverwrite"
            : "tandem.localFiles.noOverwrite",
        )}
      </small>
    </>
  ) : (
    <>
      <code>{displayCommand(step)}</code>
      {step.cwd && <small>{step.cwd}</small>}
    </>
  );
}
