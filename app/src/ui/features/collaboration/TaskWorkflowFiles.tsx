import { useTranslation } from "react-i18next";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import type { TaskFileStep, TaskFileBindings } from "@/types/task-plan";

import {
  matchingWorkflowGrants,
  workflowBindingsReady,
} from "./workflow-file-bindings";
export function TaskWorkflowFiles({
  taskId,
  steps,
  value,
  grants,
  onChange,
  disabled,
}: {
  taskId: string;
  steps: TaskFileStep[];
  value: TaskFileBindings;
  grants: HumanLocalFileGrant[];
  onChange: (v: TaskFileBindings) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return (
    <fieldset disabled={disabled}>
      <legend>{t("tandem.workflow.fileBindings")}</legend>
      <p className="tandem-task-help">
        {t("tandem.workflow.fileBindingsHint")}
      </p>
      {[...new Set(steps.map((s) => s.localFile))].map((name) => {
        const options = matchingWorkflowGrants(taskId, steps, name, grants),
          binding = value[name],
          selected = options.find(
            (g) =>
              g.id === binding?.localGrantId &&
              g.version === binding.localVersion,
          );
        return (
          <label key={name}>
            {t("tandem.workflow.localFileSlot") + " · " + name}
            <select
              aria-label={t("tandem.workflow.localFileSlot") + " · " + name}
              title={selected?.path}
              required
              value={selected?.id ?? ""}
              onChange={(e) => {
                const grant = options.find((g) => g.id === e.target.value),
                  next = { ...value };
                if (grant)
                  next[name] = {
                    localGrantId: grant.id,
                    localVersion: grant.version,
                  };
                else delete next[name];
                onChange(next);
              }}
            >
              <option value="">
                {t("tandem.workflow.chooseAuthorizedFile")}
              </option>
              {options.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.path}
                </option>
              ))}
            </select>
            {selected && (
              <small className="break-all whitespace-pre-wrap text-muted-foreground">
                {selected.path}
              </small>
            )}
          </label>
        );
      })}
      {!workflowBindingsReady(taskId, steps, value, grants) && (
        <p role="status">{t("tandem.workflow.fileBindingsRequired")}</p>
      )}
    </fieldset>
  );
}
