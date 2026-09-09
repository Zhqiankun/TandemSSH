import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Terminal, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  getMonitoringCollection,
  controlMonitoringCollection,
} from "@/api/monitoring-collection-api";
import type {
  MonitoringSnapshot,
  MonitoringActionStatus,
} from "@/types/monitoring";
const statusKeys: Record<MonitoringActionStatus, string> = {
  running: "monitoring.running",
  completed: "monitoring.completed",
  unavailable: "monitoring.unavailable",
  denied: "monitoring.denied",
  cancelled: "monitoring.cancelled",
  timeout: "monitoring.timeout",
  "output-limit": "monitoring.outputLimit",
  failed: "monitoring.failed",
};
export function MonitoringCollectionPanel({
  hostId,
  visible,
  onPausedChange,
}: {
  hostId: number;
  visible: boolean;
  onPausedChange: (paused: boolean) => void;
}) {
  const { t } = useTranslation();
  const generation = useRef(0);
  const pendingControl = useRef(false);
  const invalidate = useCallback(() => ++generation.current, []);
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const apply = useCallback(
    (value: MonitoringSnapshot) => {
      setSnapshot(value);
      onPausedChange(value.paused);
    },
    [onPausedChange],
  );
  useEffect(() => {
    invalidate();
    setSnapshot(null);
    setFailed(false);
    setBusy(false);
    pendingControl.current = false;
    if (!visible) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const refresh = async () => {
      if (pendingControl.current) {
        timer = setTimeout(refresh, 3000);
        return;
      }
      const epoch = generation.current;
      try {
        const next = await getMonitoringCollection(hostId, controller.signal);
        if (!disposed && epoch === generation.current) {
          apply(next);
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        if (!disposed) timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      invalidate();
      clearTimeout(timer);
      controller.abort();
    };
  }, [hostId, visible, apply, invalidate]);
  const control = async () => {
    if (!snapshot || busy) return;
    const epoch = invalidate();
    pendingControl.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const next = await controlMonitoringCollection(
        hostId,
        snapshot.paused ? "resume" : "pause",
      );
      if (epoch === generation.current) apply(next);
    } catch {
      if (epoch === generation.current) setFailed(true);
    } finally {
      if (epoch === generation.current) {
        pendingControl.current = false;
        setBusy(false);
      }
    }
  };
  const batches = snapshot
    ? [
        ...(snapshot.current ? [snapshot.current] : []),
        ...snapshot.recent,
      ].slice(0, 5)
    : [];
  return (
    <section
      className="mx-3 mt-3 shrink-0 border border-border bg-card"
      aria-label={t("monitoring.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <Terminal className="size-4 text-accent-brand" />
          <span className="font-semibold">{t("monitoring.title")}</span>
          <span className="text-xs text-muted-foreground">
            {!snapshot
              ? t("monitoring.loading")
              : !snapshot.metricsEnabled
                ? t("monitoring.disabled")
                : snapshot.paused
                  ? t("monitoring.paused")
                  : snapshot.current
                    ? t("monitoring.running")
                    : t("monitoring.waiting")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {snapshot && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              {t("monitoring.interval", { seconds: snapshot.intervalSeconds })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!snapshot?.metricsEnabled || busy}
            onClick={() => void control()}
          >
            {snapshot?.paused ? (
              <Play className="mr-1 size-3" />
            ) : (
              <Pause className="mr-1 size-3" />
            )}
            {t(
              busy
                ? "monitoring.working"
                : snapshot?.paused
                  ? "monitoring.resume"
                  : "monitoring.pause",
            )}
          </Button>
        </div>
      </div>
      {failed && (
        <p
          role="alert"
          className="border-t border-border px-3 py-2 text-xs text-destructive"
        >
          {t("monitoring.loadError")}
        </p>
      )}
      <details className="border-t border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          {t("monitoring.inspect", { count: snapshot?.commands.length ?? 0 })}
        </summary>
        <div className="max-h-80 space-y-3 overflow-auto border-t border-border p-3 text-xs">
          <p className="text-muted-foreground">{t("monitoring.description")}</p>
          {batches.length === 0 && (
            <p className="text-muted-foreground">{t("monitoring.noSamples")}</p>
          )}
          {batches.map((batch) => (
            <details
              key={batch.id}
              open={batch.status === "running"}
              className="border border-border"
            >
              <summary className="cursor-pointer bg-muted/30 px-2 py-2">
                {new Date(batch.startedAt).toLocaleTimeString()} ·{" "}
                {t(
                  batch.status === "running"
                    ? "monitoring.running"
                    : batch.status === "cancelled"
                      ? "monitoring.cancelled"
                      : batch.status === "partial"
                        ? "monitoring.partial"
                        : batch.status === "failed"
                          ? "monitoring.failed"
                          : "monitoring.completed",
                )}{" "}
                ·{" "}
                {t("monitoring.commandCount", { count: batch.actions.length })}
              </summary>
              <ol className="divide-y divide-border">
                {batch.actions.map((action, index) => (
                  <li
                    key={`${action.commandId}-${index}`}
                    className="space-y-1 px-2 py-2"
                  >
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <span>
                        {t(statusKeys[action.status])}
                        {action.exitCode != null &&
                          ` · ${t("monitoring.exitCode", { code: action.exitCode })}`}
                      </span>
                      <span>
                        {action.finishedAt
                          ? `${action.finishedAt - action.startedAt} ms`
                          : "…"}
                      </span>
                    </div>
                    <code className="block whitespace-pre-wrap break-all font-mono">
                      {action.command}
                    </code>
                  </li>
                ))}
              </ol>
            </details>
          ))}
          <details>
            <summary className="cursor-pointer font-semibold">
              {t("monitoring.templates")}
            </summary>
            <ul className="mt-2 divide-y divide-border">
              {snapshot?.commands.map((command) => (
                <li key={command.id} className="space-y-1 py-2">
                  <span className="text-muted-foreground">
                    {t(`monitoring.widgets.${command.widget}`)} ·{" "}
                    {t("monitoring.commandTimeout", {
                      seconds: command.timeoutMs / 1000,
                    })}
                  </span>
                  <code className="block whitespace-pre-wrap break-all font-mono">
                    {command.template}
                  </code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </section>
  );
}
