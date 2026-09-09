import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";

export function UptimeCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const uptime = metrics?.uptime;
  const seconds = uptime?.seconds;
  const formatted =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? t("monitoring.uptimeValue", {
          days: Math.floor(seconds / 86400),
          hours: Math.floor((seconds % 86400) / 3600),
          minutes: Math.floor((seconds % 3600) / 60),
        })
      : t("monitoring.unavailableValue");

  return (
    <MetricCard
      title={t("hostMetrics.uptime")}
      icon={<Clock className="size-3.5" />}
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <span className="break-keep text-xl font-bold leading-snug text-accent-brand">
          {formatted}
        </span>
        {uptime?.seconds != null && (
          <span className="font-mono text-xs text-muted-foreground">
            {Math.floor(uptime.seconds).toLocaleString()}{" "}
            {t("hostMetrics.seconds")}
          </span>
        )}
      </div>
    </MetricCard>
  );
}
