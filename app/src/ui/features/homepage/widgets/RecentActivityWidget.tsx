import { formatRecentActivityTime } from "../recent-activity-time";
import { translateUiText } from "@/i18n/ui-text";
import { useEffect, useState } from "react";
import {
  Activity,
  Terminal,
  FolderOpen,
  Container,
  Wifi,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  RecentActivityConfig,
  ActivityType,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import {
  getRecentActivity,
  type RecentActivityItem,
} from "@/api/dashboard-api";
import { WidgetTitle } from "./WidgetTitle";
import { runVisibleInterval } from "../use-visible-interval";

function ActivityIcon({ type }: { type: string }) {
  const cls = "shrink-0 text-accent-brand";
  switch (type) {
    case "terminal":
      return <Terminal size={10} className={cls} />;
    case "file_manager":
      return <FolderOpen size={10} className={cls} />;
    case "docker":
      return <Container size={10} className={cls} />;
    case "tunnel":
      return <Wifi size={10} className={cls} />;
    case "rdp":
    case "vnc":
    case "telnet":
      return <Monitor size={10} className={cls} />;
    default:
      return <Activity size={10} className={cls} />;
  }
}

function RecentActivityWidget({
  widget,
  config,
}: WidgetComponentProps<RecentActivityConfig>) {
  const { t, i18n } = useTranslation();
  const typeLabels: Record<RecentActivityItem["type"], string> = {
    terminal: t("networkGraph.terminal"),
    file_manager: t("networkGraph.fileManager"),
    server_stats: t("networkGraph.serverStats"),
    tunnel: t("networkGraph.tunnel"),
    docker: t("networkGraph.docker"),
    rdp: "RDP",
    vnc: "VNC",
    telnet: "Telnet",
  };
  const { maxItems, filterTypes, showTimestamp } = config;
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const data = await getRecentActivity(maxItems * 3);
      const filtered =
        filterTypes.length > 0
          ? data.filter((i) => filterTypes.includes(i.type as ActivityType))
          : data;
      setItems(filtered.slice(0, maxItems));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    return runVisibleInterval(() => {
      void fetchData();
    }, 60_000);
  }, [maxItems, filterTypes.join(",")]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noActivity")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || t("homepage.widgetRecentActivityName")}
        icon={<Activity size={11} />}
      />
      <div className="flex-1 overflow-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30"
          >
            <ActivityIcon type={item.type} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] font-medium text-foreground truncate">
                {item.hostName}
              </span>
              <span className="text-[9px] text-muted-foreground capitalize">
                {typeLabels[item.type] ?? item.type}
              </span>
            </div>
            {showTimestamp && (
              <span className="text-[9px] text-muted-foreground shrink-0">
                {formatRecentActivityTime(
                  item.timestamp,
                  i18n.resolvedLanguage ?? i18n.language,
                  t("dashboard.justNow"),
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<RecentActivityConfig>({
  id: "recent_activity",
  name: "Recent Activity",
  get description() {
    return translateUiText(
      "Shows recent terminal, Docker, file, and tunnel activity",
    );
  },
  category: "system",
  icon: <Activity size={14} />,
  defaultConfig: { maxItems: 10, filterTypes: [], showTimestamp: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 9 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: RecentActivityWidget,
});

export { RecentActivityWidget };
