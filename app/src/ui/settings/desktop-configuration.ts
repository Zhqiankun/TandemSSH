import {
  desktopAppearanceSchema,
  type DesktopConfiguration,
} from "@/types/desktop-preferences";
import { desktopLayoutSchema } from "@/types/desktop-layout";
import { sanitizeUiPreferences } from "@/types/ui-preferences";
const layoutKeys = {
  dashboardSlots: "dashboardTab.slots",
  dashboardMainWidthPct: "dashboardTab.mainWidthPct",
  dashboardView: "dashboardView",
} as const;
const appearanceKeys = {
  theme: "vite-ui-theme",
  fontSize: "termix-font-size",
  accentColor: "termix-accent",
  language: "tandemssh.language",
  hiddenRailTabs: "hiddenRailTabs",
} as const;
export function captureDesktopConfiguration(
  storage: Storage = localStorage,
): DesktopConfiguration {
  const appearance: Record<string, unknown> = {
    theme: "dark",
    fontSize: "md",
    accentColor: "#f59145",
    language: "zh-CN",
    hiddenRailTabs: "[]",
  };
  for (const [field, key] of Object.entries(appearanceKeys)) {
    const value = storage.getItem(key);
    if (value !== null) appearance[field] = value;
  }
  const parsed = desktopAppearanceSchema.parse(appearance),
    raw = storage.getItem("uiPreferences");
  const layout: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(layoutKeys)) {
    const value = storage.getItem(key);
    layout[field] =
      value === null
        ? null
        : field === "dashboardSlots"
          ? JSON.parse(value)
          : field === "dashboardMainWidthPct"
            ? Number(value)
            : value;
  }
  return {
    layout: desktopLayoutSchema.parse(layout),
    appearance: parsed,
    preferences: raw ? sanitizeUiPreferences(JSON.parse(raw)) : undefined,
  };
}
export function applyDesktopConfiguration(
  input: DesktopConfiguration,
  storage: Storage = localStorage,
): void {
  const values = new Map<string, string | null>();
  if (input.layout) {
    const layout = desktopLayoutSchema.parse(input.layout);
    for (const [field, key] of Object.entries(layoutKeys)) {
      const value = layout[field as keyof typeof layout];
      if (value !== undefined)
        values.set(
          key,
          value === null
            ? null
            : field === "dashboardSlots"
              ? JSON.stringify(value)
              : String(value),
        );
    }
  }
  if (input.appearance) {
    const appearance = desktopAppearanceSchema.parse(input.appearance);
    for (const [field, key] of Object.entries(appearanceKeys)) {
      const value = appearance[field as keyof typeof appearance];
      if (value !== undefined) values.set(key, value);
    }
  }
  if (input.preferences)
    values.set(
      "uiPreferences",
      JSON.stringify(sanitizeUiPreferences(input.preferences)),
    );
  const previous = new Map<string, string | null>();
  try {
    for (const key of values.keys()) previous.set(key, storage.getItem(key));
    for (const [key, value] of values) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
  } catch {
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        /* The UI keeps the committed result and exposes retry if local storage remains unavailable. */
      }
    }
    throw Error("BACKUP_LOCAL_RESTORE_FAILED");
  }
}
