import type { SplitMode, SplitTabConfig, Tab } from "@/types/ui-types";

const EMPTY_PANES = 6;

export type PersistedSplitTab = {
  instanceId: string;
  label: string;
  mode: Exclude<SplitMode, "none">;
  paneInstanceIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
};

export function createSplitConfig(
  mode: Exclude<SplitMode, "none">,
  paneTabIds: (string | null)[],
  sizes: Pick<SplitTabConfig, "rowSizes" | "rowColSizes">,
): SplitTabConfig {
  return {
    mode,
    paneTabIds: [...paneTabIds, ...Array(EMPTY_PANES).fill(null)].slice(
      0,
      EMPTY_PANES,
    ),
    rowSizes: [...sizes.rowSizes],
    rowColSizes: sizes.rowColSizes.map((row) => [...row]),
  };
}

export function assignTabsToSplit(
  tabs: Tab[],
  splitTabId: string,
  paneTabIds: (string | null)[],
): Tab[] {
  const target = tabs.find((tab) => tab.id === splitTabId);
  if (target?.type !== "split-screen") return tabs;
  const eligible = new Set(
    tabs.filter((tab) => tab.type !== "split-screen").map((tab) => tab.id),
  );
  const assigned = new Set<string>();
  const panes = Array.from({ length: EMPTY_PANES }, (_, index) => {
    const id = paneTabIds[index];
    if (!id || !eligible.has(id) || assigned.has(id)) return null;
    assigned.add(id);
    return id;
  });
  return tabs.map((tab) => {
    if (tab.id === splitTabId) {
      return tab.splitConfig
        ? { ...tab, splitConfig: { ...tab.splitConfig, paneTabIds: panes } }
        : tab;
    }
    if (tab.type === "split-screen" && tab.splitConfig) {
      if (!tab.splitConfig.paneTabIds.some((id) => id && assigned.has(id))) {
        return tab;
      }
      return {
        ...tab,
        splitConfig: {
          ...tab.splitConfig,
          paneTabIds: tab.splitConfig.paneTabIds.map((id) =>
            id && assigned.has(id) ? null : id,
          ),
        },
      };
    }
    if (assigned.has(tab.id)) return { ...tab, parentSplitTabId: splitTabId };
    if (tab.parentSplitTabId === splitTabId) {
      const { parentSplitTabId: _removed, ...released } = tab;
      return released;
    }
    return tab;
  });
}

export function releaseSplitTabs(tabs: Tab[], splitTabId: string): Tab[] {
  return tabs
    .filter((tab) => tab.id !== splitTabId)
    .map((tab) => {
      if (tab.parentSplitTabId !== splitTabId) return tab;
      const { parentSplitTabId: _removed, ...released } = tab;
      return released;
    });
}

export function serializeSplitTabs(tabs: Tab[]): PersistedSplitTab[] {
  const instanceIdById = new Map(tabs.map((tab) => [tab.id, tab.instanceId]));
  return tabs.flatMap((tab) => {
    if (tab.type !== "split-screen" || !tab.splitConfig) return [];
    return [
      {
        instanceId: tab.instanceId,
        label: tab.label,
        mode: tab.splitConfig.mode,
        paneInstanceIds: tab.splitConfig.paneTabIds.map((id) =>
          id ? (instanceIdById.get(id) ?? null) : null,
        ),
        rowSizes: [...tab.splitConfig.rowSizes],
        rowColSizes: tab.splitConfig.rowColSizes.map((row) => [...row]),
      },
    ];
  });
}

// Persisted JSON is untrusted layout data, not a typed runtime configuration.
function isPersistedSplitTab(value: unknown): value is PersistedSplitTab {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const shapes: Record<string, number[]> = {
    "2-way": [2],
    "2-way-horizontal": [1, 1],
    "3-way": [2, 1],
    "3-way-horizontal": [2, 1],
    "4-way": [2, 2],
    "5-way": [3, 2],
    "6-way": [3, 3],
  };
  const shape =
    typeof item.mode === "string" && Object.hasOwn(shapes, item.mode)
      ? shapes[item.mode]
      : undefined;
  const validSizes = (sizes: unknown, length: number): sizes is number[] =>
    Array.isArray(sizes) &&
    sizes.length === length &&
    sizes.every(
      (size) =>
        typeof size === "number" &&
        Number.isFinite(size) &&
        size > 0 &&
        size <= 100,
    ) &&
    Math.abs(sizes.reduce((sum, size) => sum + size, 0) - 100) < 0.5;
  return (
    !!shape &&
    typeof item.instanceId === "string" &&
    item.instanceId.length > 0 &&
    typeof item.label === "string" &&
    Array.isArray(item.paneInstanceIds) &&
    item.paneInstanceIds.every((id) => id === null || typeof id === "string") &&
    validSizes(item.rowSizes, shape.length) &&
    Array.isArray(item.rowColSizes) &&
    item.rowColSizes.length === shape.length &&
    item.rowColSizes.every((row, index) => validSizes(row, shape[index]))
  );
}

export function restoreSplitTabs(
  persisted: unknown,
  tabs: Tab[],
  openedAt = Date.now(),
): Tab[] {
  if (!Array.isArray(persisted)) return tabs;
  const tabIdByInstanceId = new Map(
    tabs.map((tab) => [tab.instanceId, tab.id]),
  );
  let next = [...tabs];

  for (const saved of persisted) {
    if (!isPersistedSplitTab(saved)) continue;
    const id = `split-${saved.instanceId}`;
    if (
      next.some((tab) => tab.id === id || tab.instanceId === saved.instanceId)
    )
      continue;
    const paneTabIds = saved.paneInstanceIds.map((instanceId) =>
      instanceId ? (tabIdByInstanceId.get(instanceId) ?? null) : null,
    );
    if (!paneTabIds.some(Boolean)) continue;
    const splitTab: Tab = {
      id,
      instanceId: saved.instanceId,
      type: "split-screen",
      label: saved.label,
      openedAt,
      splitConfig: createSplitConfig(saved.mode, paneTabIds, saved),
    };
    next = assignTabsToSplit([...next, splitTab], id, paneTabIds);
  }

  return next;
}
