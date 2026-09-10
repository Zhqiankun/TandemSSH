import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { taskHistoryApi } from "@/api/task-history-api";
import type { HistoryExportProgress } from "@/api/history-export-stream";
import type { AuditExportSummary } from "@/types/task-history";
export function HistoryExport({ taskId }: { taskId?: string }) {
  const { t } = useTranslation(),
    active = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<HistoryExportProgress>(),
    [result, setResult] = useState<AuditExportSummary>(),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = undefined;
    },
    [],
  );
  const run = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setProgress({ bytes: 0, records: 0 });
    setResult(undefined);
    setError(undefined);
    try {
      const exported = await taskHistoryApi.export(
        { taskId },
        controller.signal,
        (value) => {
          if (active.current === controller && !controller.signal.aborted)
            setProgress(value);
        },
      );
      if (active.current !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(exported.blob),
        link = document.createElement("a");
      try {
        link.href = url;
        link.download =
          "TandemSSH-history-" +
          new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) +
          ".jsonl";
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setResult(exported.summary);
    } catch (e) {
      if (active.current !== controller) return;
      const message = e instanceof Error ? e.message : "";
      setError(
        controller.signal.aborted
          ? "HISTORY_EXPORT_CANCELLED"
          : /^HISTORY_EXPORT_[A-Z_]+$/.test(message)
            ? message
            : "HISTORY_EXPORT_FAILED",
      );
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="rounded border border-border p-3 space-y-2"
      aria-label={t("tandem.history.exportTitle")}
    >
      <p className="text-xs text-muted-foreground">
        {t("tandem.history.exportHint")}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run()}
        >
          {t(taskId ? "tandem.history.exportTask" : "tandem.history.exportAll")}
        </Button>
        {busy && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => active.current?.abort()}
          >
            {t("common.cancel")}
          </Button>
        )}
      </div>
      {busy && progress && (
        <p role="status" className="text-xs">
          {t("tandem.history.exportProgress", {
            count: progress.records,
            kib: Math.ceil(progress.bytes / 1024),
          })}
        </p>
      )}
      {result && (
        <p role="status" className="text-xs">
          {t("tandem.history.exportReady", { count: result.records })}
        </p>
      )}
      {!!result?.skipped && (
        <p role="alert" className="text-xs text-amber-500">
          {t("tandem.history.exportSkipped", { count: result.skipped })}
        </p>
      )}
      {error && (
        <p
          role={error === "HISTORY_EXPORT_CANCELLED" ? "status" : "alert"}
          className="text-xs text-amber-500"
        >
          {t("tandem.history.exportErrors." + error, {
            defaultValue: t(
              "tandem.history.exportErrors.HISTORY_EXPORT_FAILED",
            ),
          })}
        </p>
      )}
    </section>
  );
}
