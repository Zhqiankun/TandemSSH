import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import type { WorkflowDefinition } from "@/types/workflow";
export function WorkflowFileSlots({
  definition,
  onChange,
}: {
  definition: WorkflowDefinition;
  onChange: (d: WorkflowDefinition) => void;
}) {
  const { t } = useTranslation(),
    [name, setName] = useState(""),
    [direction, setDirection] = useState<"upload" | "download">("upload"),
    [kind, setKind] = useState<"file" | "directory">("file");
  return (
    <section>
      <h3>{t("tandem.workflow.fileSlots")}</h3>
      <p className="tandem-settings-help">
        {t("tandem.workflow.fileSlotsHint")}
      </p>
      {Object.entries(definition.files ?? {}).map(([key, slot]) => (
        <div className="tandem-settings-row" key={key}>
          <strong>{key}</strong>
          <span>
            {t(
              slot.kind === "directory"
                ? "tandem.directoryTask.direction." + slot.direction
                : "tandem.collaboration.fileActions." + slot.direction,
            )}
          </span>
          <input
            aria-label={t("tandem.workflow.fileSlotDescription") + " · " + key}
            value={slot.description ?? ""}
            onChange={(e) =>
              onChange({
                ...definition,
                files: {
                  ...definition.files,
                  [key]: { ...slot, description: e.target.value },
                },
              })
            }
          />
          <Button
            variant="ghost"
            disabled={definition.steps.some(
              (s) => "localFile" in s.action && s.action.localFile === key,
            )}
            onClick={() => {
              const files = { ...definition.files };
              delete files[key];
              onChange({ ...definition, files });
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      ))}
      <div className="tandem-settings-row">
        <input
          aria-label={t("tandem.workflow.fileSlotName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label={t("tandem.workflow.fileSlotKind")}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="file">{t("tandem.workflow.singleFileSlot")}</option>
          <option value="directory">
            {t("tandem.workflow.directorySlot")}
          </option>
        </select>
        <select
          aria-label={t("tandem.workflow.fileSlotDirection")}
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
        >
          <option value="upload">
            {t("tandem.collaboration.fileActions.upload")}
          </option>
          <option value="download">
            {t("tandem.collaboration.fileActions.download")}
          </option>
        </select>
        <Button
          variant="outline"
          disabled={
            !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ||
            Object.hasOwn(definition.files ?? {}, name) ||
            Object.keys(definition.files ?? {}).length >= 64
          }
          onClick={() => {
            onChange({
              ...definition,
              schemaVersion:
                kind === "directory" || definition.schemaVersion === 3 ? 3 : 2,
              files: {
                ...definition.files,
                [name]: {
                  direction,
                  ...(kind === "directory"
                    ? { kind: "directory" as const }
                    : {}),
                },
              },
            });
            setName("");
          }}
        >
          {t("tandem.workflow.addFileSlot")}
        </Button>
      </div>
    </section>
  );
}
