import { beforeEach, expect, it, vi } from "vitest";
import {
  captureDesktopConfiguration,
  applyDesktopConfiguration,
} from "@/settings/desktop-configuration";
import { desktopAppearanceSchema } from "@/types/desktop-preferences";
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("captures visible-by-default navigation and round trips hidden destinations", () => {
  expect(captureDesktopConfiguration().appearance?.hiddenRailTabs).toBe("[]");
  localStorage.setItem(
    "hiddenRailTabs",
    '["ai","serial","network_graph","ai"]',
  );
  const backup = captureDesktopConfiguration();
  expect(backup.appearance?.hiddenRailTabs).toBe(
    '["ai","serial","network_graph"]',
  );
  localStorage.clear();
  applyDesktopConfiguration(backup);
  expect(localStorage.getItem("hiddenRailTabs")).toBe(
    '["ai","serial","network_graph"]',
  );
});
it("preserves target navigation and AI switches when the old backup omits visibility", () => {
  localStorage.setItem("hiddenRailTabs", '["ai"]');
  localStorage.setItem("aiAssistantEnabled", "false");
  applyDesktopConfiguration({ appearance: { theme: "nord" } });
  expect(localStorage.getItem("hiddenRailTabs")).toBe('["ai"]');
  expect(localStorage.getItem("aiAssistantEnabled")).toBe("false");
});
it("can explicitly restore all visible without changing the AI opt-in", () => {
  localStorage.setItem("hiddenRailTabs", '["ai"]');
  localStorage.setItem("aiAssistantEnabled", "false");
  applyDesktopConfiguration({ appearance: { hiddenRailTabs: "[]" } });
  expect(localStorage.getItem("hiddenRailTabs")).toBe("[]");
  expect(localStorage.getItem("aiAssistantEnabled")).toBe("false");
});
it.each([
  "null",
  "{}",
  "[1]",
  "broken",
  '["bad\\nvalue"]',
  JSON.stringify(Array(65).fill("ai")),
  JSON.stringify(["x".repeat(65)]),
])("rejects malformed visibility before writing: %s", (hiddenRailTabs) => {
  localStorage.setItem("vite-ui-theme", "dark");
  expect(() =>
    applyDesktopConfiguration({
      appearance: { theme: "nord", hiddenRailTabs },
    }),
  ).toThrow();
  expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
  expect(localStorage.getItem("hiddenRailTabs")).toBeNull();
});
it("allows bounded destination IDs from newer versions without accepting capability fields", () => {
  expect(
    desktopAppearanceSchema.parse({
      hiddenRailTabs: '["future-panel"]',
      aiAssistantEnabled: true,
    }),
  ).toEqual({ hiddenRailTabs: '["future-panel"]' });
});
it("rolls back preceding local writes if saving visibility fails", () => {
  localStorage.setItem("vite-ui-theme", "dark");
  localStorage.setItem("hiddenRailTabs", '["ai"]');
  const write = Storage.prototype.setItem;
  let fail = true;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === "hiddenRailTabs" && fail) {
      fail = false;
      throw Error("quota");
    }
    write.call(this, key, value);
  });
  expect(() =>
    applyDesktopConfiguration({
      appearance: { theme: "nord", hiddenRailTabs: "[]" },
    }),
  ).toThrow("BACKUP_LOCAL_RESTORE_FAILED");
  expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
  expect(localStorage.getItem("hiddenRailTabs")).toBe('["ai"]');
});

it("round trips a custom dashboard arrangement, width and selected page", () => {
  const slots = [
    {
      key: "quick_0",
      id: "quick_actions",
      panel: "side",
      order: 3,
      height: 180,
    },
    { key: "stats_0", id: "stats_bar", panel: "main", order: 0, height: null },
  ];
  localStorage.setItem("dashboardTab.slots", JSON.stringify(slots));
  localStorage.setItem("dashboardTab.mainWidthPct", "55.5");
  localStorage.setItem("dashboardView", "homepage");
  const backup = captureDesktopConfiguration();
  localStorage.clear();
  applyDesktopConfiguration(backup);
  expect(JSON.parse(localStorage.getItem("dashboardTab.slots")!)).toEqual(
    slots,
  );
  expect(localStorage.getItem("dashboardTab.mainWidthPct")).toBe("55.5");
  expect(localStorage.getItem("dashboardView")).toBe("homepage");
});
it("restores explicit default layout while preserving fields omitted by an old backup", () => {
  localStorage.setItem("dashboardTab.mainWidthPct", "55");
  applyDesktopConfiguration({ appearance: { theme: "nord" } });
  expect(localStorage.getItem("dashboardTab.mainWidthPct")).toBe("55");
  applyDesktopConfiguration({ layout: { dashboardMainWidthPct: null } });
  expect(localStorage.getItem("dashboardTab.mainWidthPct")).toBeNull();
});
it("rolls back removed layout keys if a later preference write fails", () => {
  localStorage.setItem("dashboardTab.mainWidthPct", "55");
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === "vite-ui-theme") throw Error("quota");
    write.call(this, key, value);
  });
  expect(() =>
    applyDesktopConfiguration({
      layout: { dashboardMainWidthPct: null },
      appearance: { theme: "nord" },
    }),
  ).toThrow("BACKUP_LOCAL_RESTORE_FAILED");
  expect(localStorage.getItem("dashboardTab.mainWidthPct")).toBe("55");
});
