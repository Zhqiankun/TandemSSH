import { useTranslation } from "react-i18next";
import type { AuditHistoryItem } from "@/types/task-history";
export function HistoryRecordSummary({ item }: { item: AuditHistoryItem }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          {t("tandem.history.sourceLabel")}:{" "}
          {t("tandem.history.origins." + (item.origin ?? "unknown"))}
        </span>
        {item.mode && (
          <span>
            {t("tandem.history.modeLabel")}:{" "}
            {t("tandem.history.modes." + item.mode)}
          </span>
        )}
        {item.hostName ? (
          <span>
            {t("tandem.history.hostLabel")}: {item.hostName}
          </span>
        ) : item.sessionId ? (
          <span className="break-all">
            {t("tandem.history.sessionLabel")}: {item.sessionId}
          </span>
        ) : (
          <span>
            {t("tandem.history.hostLabel")}: {t("tandem.history.notRecorded")}
          </span>
        )}
        {item.policyRevision !== undefined && (
          <span>
            {t("tandem.history.policyLabel")}: v{item.policyRevision}
          </span>
        )}
        {item.policyOutcome && (
          <span>
            {t("tandem.history.decisionLabel")}:{" "}
            {t("tandem.history.decisions." + item.policyOutcome)}
          </span>
        )}
        {item.exitCode !== undefined && (
          <span>
            {t("tandem.history.exitLabel")}: {item.exitCode}
          </span>
        )}
      </div>
      {item.error && (
        <p className="break-all text-destructive">
          {t("tandem.history.errorLabel")}:{" "}
          {t("tandem.collaboration.errors." + item.error, {
            defaultValue: item.error,
          })}
        </p>
      )}
      {item.cwd && (
        <p className="break-all">
          {t("tandem.history.directoryLabel")}: {item.cwd}
        </p>
      )}
      {item.outputPreview && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2">
          {item.outputPreview}
        </pre>
      )}
      {item.outputTruncated && (
        <p className="text-muted-foreground">
          {t("tandem.history.previewOnly")}
        </p>
      )}
    </div>
  );
}
