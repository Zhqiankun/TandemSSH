import { describe, expect, it } from "vitest";
import type { Tab } from "@/types/ui-types";
import {
  assignTabsToSplit,
  createSplitConfig,
  releaseSplitTabs,
  restoreSplitTabs,
  serializeSplitTabs,
} from "@/shell/splitTabUtils";

const session = (id: string): Tab => ({
  id,
  instanceId: `instance-${id}`,
  type: "terminal",
  label: id,
  openedAt: 1,
});

describe("split tab state", () => {
  it("moves assigned sessions under a split tab and releases removed panes", () => {
    const split: Tab = {
      id: "split-1",
      instanceId: "split-instance",
      type: "split-screen",
      label: "Split #1",
      openedAt: 1,
      splitConfig: createSplitConfig("2-way", ["a", "b"], {
        rowSizes: [100],
        rowColSizes: [[50, 50]],
      }),
    };

    const assigned = assignTabsToSplit(
      [session("a"), session("b"), split],
      split.id,
      ["a", "b"],
    );
    expect(assigned.slice(0, 2).map((tab) => tab.parentSplitTabId)).toEqual([
      split.id,
      split.id,
    ]);

    const updated = assignTabsToSplit(assigned, split.id, ["a", null]);
    expect(updated.find((tab) => tab.id === "a")?.parentSplitTabId).toBe(
      split.id,
    );
    expect(updated.find((tab) => tab.id === "b")?.parentSplitTabId).toBe(
      undefined,
    );
  });

  it("releases child sessions when the split tab closes", () => {
    const tabs = assignTabsToSplit(
      [
        session("a"),
        {
          id: "split-1",
          instanceId: "split-instance",
          type: "split-screen",
          label: "Split #1",
          openedAt: 1,
        },
      ],
      "split-1",
      ["a"],
    );
    expect(releaseSplitTabs(tabs, "split-1")).toEqual([session("a")]);
  });

  it("persists pane membership by stable instance id", () => {
    const members = [session("a"), session("b")];
    const split: Tab = {
      id: "split-1",
      instanceId: "workspace-1",
      type: "split-screen",
      label: "Production",
      openedAt: 1,
      splitConfig: createSplitConfig("2-way", ["a", "b"], {
        rowSizes: [100],
        rowColSizes: [[40, 60]],
      }),
    };
    const saved = serializeSplitTabs([...members, split]);
    const restoredMembers = [
      { ...session("new-a"), instanceId: "instance-a" },
      { ...session("new-b"), instanceId: "instance-b" },
    ];
    const restored = restoreSplitTabs(saved, restoredMembers, 2);
    const restoredSplit = restored.find((tab) => tab.type === "split-screen");

    expect(restoredSplit?.label).toBe("Production");
    expect(restoredSplit?.splitConfig?.paneTabIds.slice(0, 2)).toEqual([
      "new-a",
      "new-b",
    ]);
    expect(restoredMembers.map((tab) => tab.id)).toEqual(["new-a", "new-b"]);
    expect(
      restored
        .filter((tab) => tab.type === "terminal")
        .map((tab) => tab.parentSplitTabId),
    ).toEqual(["split-workspace-1", "split-workspace-1"]);
  });
});

it("keeps restored ownership and pane references consistent across overlapping splits", () => {
  const saved = (instanceId: string, paneInstanceIds: (string | null)[]) => ({
    instanceId,
    label: instanceId,
    mode: "2-way" as const,
    paneInstanceIds,
    rowSizes: [100],
    rowColSizes: [[50, 50]],
  });
  const restored = restoreSplitTabs(
    [
      saved("one", ["instance-a", "instance-b"]),
      saved("two", ["instance-a", "instance-a"]),
    ],
    [session("a"), session("b")],
  );
  expect(
    restored
      .find((t) => t.id === "split-one")
      ?.splitConfig?.paneTabIds.slice(0, 2),
  ).toEqual([null, "b"]);
  expect(
    restored
      .find((t) => t.id === "split-two")
      ?.splitConfig?.paneTabIds.slice(0, 2),
  ).toEqual(["a", null]);
  expect(restored.find((t) => t.id === "a")?.parentSplitTabId).toBe(
    "split-two",
  );
  const released = releaseSplitTabs(restored, "split-two");
  expect(released.find((t) => t.id === "a")?.parentSplitTabId).toBeUndefined();
  expect(
    released.find((t) => t.id === "split-one")?.splitConfig?.paneTabIds,
  ).not.toContain("a");
  expect(serializeSplitTabs(released)[0].paneInstanceIds.slice(0, 2)).toEqual([
    null,
    "instance-b",
  ]);
});
it("ignores missing or nested split references and assignments beyond six panes", () => {
  const split: Tab = {
    ...session("split"),
    type: "split-screen",
    splitConfig: createSplitConfig("6-way", [], {
      rowSizes: [50, 50],
      rowColSizes: [
        [33, 33, 34],
        [33, 33, 34],
      ],
    }),
  };
  const members = Array.from({ length: 7 }, (_, i) => session(String(i)));
  const assigned = assignTabsToSplit(
    [...members, split],
    split.id,
    members.map((t) => t.id),
  );
  expect(assigned.find((t) => t.id === "6")?.parentSplitTabId).toBeUndefined();
  const invalid = assignTabsToSplit(assigned, split.id, [
    "missing",
    split.id,
    "0",
    "0",
  ]);
  expect(
    invalid.find((t) => t.id === split.id)?.splitConfig?.paneTabIds,
  ).toEqual([null, null, "0", null, null, null]);
  expect(split.splitConfig?.paneTabIds).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});

it("restores valid neighbors while skipping malformed persisted entries", () => {
  const valid = {
    instanceId: "valid",
    label: "生产分屏",
    mode: "2-way",
    paneInstanceIds: ["instance-a"],
    rowSizes: [100],
    rowColSizes: [[50, 50]],
  };
  const inputs = [
    null,
    {},
    { ...valid, instanceId: "bad-mode", mode: "none" },
    { ...valid, instanceId: "bad-sizes", rowColSizes: [null] },
    { ...valid, instanceId: "negative", rowSizes: [-1] },
    valid,
    { ...valid, label: "duplicate" },
  ];
  const restored = restoreSplitTabs(
    inputs as unknown as Parameters<typeof restoreSplitTabs>[0],
    [session("a")],
  );
  expect(
    restored.filter((t) => t.type === "split-screen").map((t) => t.label),
  ).toEqual(["生产分屏"]);
  expect(restored.find((t) => t.id === "a")?.parentSplitTabId).toBe(
    "split-valid",
  );
});
it("leaves existing tabs intact for a non-array persisted value", () => {
  const tabs = [session("a")];
  expect(
    restoreSplitTabs(
      null as unknown as Parameters<typeof restoreSplitTabs>[0],
      tabs,
    ),
  ).toEqual(tabs);
});

it.each([
  "2-way",
  "2-way-horizontal",
  "3-way",
  "3-way-horizontal",
  "4-way",
  "5-way",
  "6-way",
] as const)("restores the shipped default sizes for %s", async (mode) => {
  const { defaultSizes } = await import("../../shell/SplitView");
  const restored = restoreSplitTabs(
    [
      {
        instanceId: mode,
        label: mode,
        mode,
        paneInstanceIds: ["instance-a"],
        ...defaultSizes(mode),
      },
    ],
    [session("a")],
  );
  expect(
    restored.find((t) => t.type === "split-screen")?.splitConfig?.mode,
  ).toBe(mode);
});
