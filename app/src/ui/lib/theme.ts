import { translateUiText } from "@/i18n/ui-text";
import type {
  DashboardCardConfig,
  FontSizeId,
  SplitMode,
} from "@/types/ui-types";

export const DASHBOARD_CARDS: DashboardCardConfig[] = [
  {
    id: "stats_bar",
    get label() {
      return translateUiText("Status Bar");
    },
    get description() {
      return translateUiText("Version, uptime, database health, hosts online");
    },
    defaultEnabled: true,
  },
  {
    id: "counters_bar",
    get label() {
      return translateUiText("Counters Bar");
    },
    get description() {
      return translateUiText("Total hosts, credentials, and tunnels count");
    },
    defaultEnabled: true,
  },
  {
    id: "quick_actions",
    get label() {
      return translateUiText("Quick Actions");
    },
    get description() {
      return translateUiText("Shortcuts to add hosts, credentials, settings");
    },
    defaultEnabled: true,
  },
  {
    id: "host_status",
    get label() {
      return translateUiText("Host Status");
    },
    get description() {
      return translateUiText("Live status list with CPU/RAM per host");
    },
    defaultEnabled: true,
  },
  {
    id: "recent_activity",
    get label() {
      return translateUiText("Recent Activity");
    },
    get description() {
      return translateUiText("Feed of recent connection events");
    },
    defaultEnabled: true,
  },
  {
    id: "network_graph",
    get label() {
      return translateUiText("Network Graph");
    },
    get description() {
      return translateUiText("Visual map of host network topology");
    },
    defaultEnabled: false,
  },
  {
    id: "service_links",
    get label() {
      return translateUiText("Service Links");
    },
    get description() {
      return translateUiText(
        "Clickable buttons linking to services on your servers",
      );
    },
    defaultEnabled: false,
  },
  {
    id: "homepage_preview",
    get label() {
      return translateUiText("Homepage");
    },
    get description() {
      return translateUiText("Scaled preview of your Homepage canvas");
    },
    defaultEnabled: false,
  },
];

export const ACCENT_PRESET_COLORS = [
  {
    get label() {
      return translateUiText("Orange");
    },
    value: "#f59145",
  },
  {
    get label() {
      return translateUiText("Blue");
    },
    value: "#3b82f6",
  },
  {
    get label() {
      return translateUiText("Green");
    },
    value: "#22c55e",
  },
  {
    get label() {
      return translateUiText("Purple");
    },
    value: "#a855f7",
  },
  {
    get label() {
      return translateUiText("Pink");
    },
    value: "#ec4899",
  },
  {
    get label() {
      return translateUiText("Cyan");
    },
    value: "#06b6d4",
  },
  {
    get label() {
      return translateUiText("Red");
    },
    value: "#ef4444",
  },
  {
    get label() {
      return translateUiText("Yellow");
    },
    value: "#eab308",
  },
  {
    get label() {
      return translateUiText("Teal");
    },
    value: "#14b8a6",
  },
  {
    get label() {
      return translateUiText("Indigo");
    },
    value: "#6366f1",
  },
  {
    get label() {
      return translateUiText("Rose");
    },
    value: "#f43f5e",
  },
  {
    get label() {
      return translateUiText("Lime");
    },
    value: "#84cc16",
  },
];

export function applyAccentColor(colorValue: string) {
  document.documentElement.style.setProperty("--accent-brand", colorValue);
}

export const FONT_SIZES: { id: FontSizeId; label: string }[] = [
  { id: "xs", label: "XS" },
  {
    id: "sm",
    get label() {
      return translateUiText("Small");
    },
  },
  {
    id: "md",
    get label() {
      return translateUiText("Normal");
    },
  },
  {
    id: "lg",
    get label() {
      return translateUiText("Large");
    },
  },
  { id: "xl", label: "XL" },
];

export function applyFontSize(id: FontSizeId) {
  const root = document.documentElement;
  root.classList.remove("fs-xs", "fs-sm", "fs-md", "fs-lg", "fs-xl");
  root.classList.add(`fs-${id}`);
  localStorage.setItem("termix-font-size", id);
}

export const FOLDER_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

export const SPLIT_MODES: { id: SplitMode; label: string }[] = [
  {
    id: "none",
    get label() {
      return translateUiText("None");
    },
  },
  {
    id: "2-way",
    get label() {
      return translateUiText("2-Way");
    },
  },
  {
    id: "2-way-horizontal",
    get label() {
      return translateUiText("2-Way (H)");
    },
  },
  {
    id: "3-way",
    get label() {
      return translateUiText("3-Way (V)");
    },
  },
  {
    id: "3-way-horizontal",
    get label() {
      return translateUiText("3-Way (H)");
    },
  },
  {
    id: "4-way",
    get label() {
      return translateUiText("4-Way");
    },
  },
  {
    id: "5-way",
    get label() {
      return translateUiText("5-Way");
    },
  },
  {
    id: "6-way",
    get label() {
      return translateUiText("6-Way");
    },
  },
];

export const PANE_COUNTS: Record<SplitMode, number> = {
  none: 0,
  "2-way": 2,
  "2-way-horizontal": 2,
  "3-way": 3,
  "3-way-horizontal": 3,
  "4-way": 4,
  "5-way": 5,
  "6-way": 6,
};
