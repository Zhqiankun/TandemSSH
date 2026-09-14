import { splitDragState, registerFitCallback } from "@/lib/splitDragging";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { SplitView, defaultSizes } from "../../shell/SplitView";

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    instanceId: "instance-1",
    type: "terminal",
    label: "web-01",
    openedAt: 0,
    ...overrides,
  } as Tab;
}

afterEach(() => {
  cleanup();
});

describe("defaultSizes", () => {
  it("returns the expected default split for 2-way", () => {
    expect(defaultSizes("2-way")).toEqual({
      rowSizes: [100],
      rowColSizes: [[50, 50]],
    });
  });

  it("returns stacked defaults for a horizontal 2-way layout", () => {
    expect(defaultSizes("2-way-horizontal")).toEqual({
      rowSizes: [50, 50],
      rowColSizes: [[100], [100]],
    });
  });

  it("returns a single full pane for 'none'", () => {
    expect(defaultSizes("none")).toEqual({
      rowSizes: [100],
      rowColSizes: [[100]],
    });
  });
});

describe("SplitView - controlled rowSizes/rowColSizes", () => {
  it("renders panes using externally-supplied non-default sizes, not the built-in default", () => {
    const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2", label: "t2" })];

    const { container } = render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[30, 70]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );

    // The first pane's flex column width should reflect the supplied 30%,
    // not the 50/50 default - this is the regression guard for the
    // rowSizes/rowColSizes lift-up out of SplitView's old internal state.
    const widthStyled = container.querySelectorAll('[style*="width: 30%"]');
    expect(widthStyled.length).toBeGreaterThan(0);
  });

  it("calls onReset (not an internal reset) when the Reset button is clicked", () => {
    const onReset = vi.fn();
    const tabs = [makeTab({ id: "t1" })];

    render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", null, null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[30, 70]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getByTitle("恢复等分布局"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("releases a session from its pane from the pane header", () => {
    const onAssignPane = vi.fn();
    render(
      <SplitView
        tabs={[makeTab({ id: "t1" })]}
        paneTabIds={["t1", null, null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[50, 50]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
        onAssignPane={onAssignPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("terminal.split.removeFromSplit"));
    expect(onAssignPane).toHaveBeenCalledWith(0, "");
  });

  it("does not mutate rowSizes/rowColSizes props locally - reflects prop changes on rerender", () => {
    const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2", label: "t2" })];

    const { container, rerender } = render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[50, 50]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );
    expect(
      container.querySelectorAll('[style*="width: 50%"]').length,
    ).toBeGreaterThan(0);

    rerender(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[20, 80]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );
    expect(
      container.querySelectorAll('[style*="width: 20%"]').length,
    ).toBeGreaterThan(0);
  });
});

// Drag cancellation must release the shared terminal fit suppression flag.
describe("split drag lifecycle", () => {
  function setup(mode: "2-way" | "2-way-horizontal" = "2-way") {
    const changed = vi.fn();
    const view = render(
      <SplitView
        tabs={[]}
        paneTabIds={[]}
        splitMode={mode}
        {...defaultSizes(mode)}
        onRowSizesChange={changed}
        onRowColSizesChange={changed}
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 600,
    } as DOMRect);
    const divider = view.container.querySelector(
      mode === "2-way" ? ".cursor-col-resize" : ".cursor-row-resize",
    )!;
    return { ...view, changed, divider };
  }
  it.each(["2-way", "2-way-horizontal"] as const)(
    "releases %s mouse drag on unmount and ignores late movement",
    (mode) => {
      const view = setup(mode);
      fireEvent.mouseDown(view.divider, { clientX: 100, clientY: 100 });
      expect(splitDragState.active).toBe(true);
      view.unmount();
      expect(splitDragState.active).toBe(false);
      fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
      expect(view.changed).not.toHaveBeenCalled();
    },
  );
  it("ends a mouse drag on window blur and notifies fit exactly once", () => {
    const view = setup(),
      fit = vi.fn(),
      unregister = registerFitCallback(fit);
    try {
      fireEvent.mouseDown(view.divider, { clientX: 100 });
      fireEvent.blur(window);
      expect(splitDragState.active).toBe(false);
      expect(fit).toHaveBeenCalledOnce();
      fireEvent.mouseUp(window);
      fireEvent.mouseMove(window, { clientX: 150 });
      expect(fit).toHaveBeenCalledOnce();
      expect(view.changed).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
  it.each(["2-way", "2-way-horizontal"] as const)(
    "ends cancelled %s touch drag without stale movement",
    (mode) => {
      const view = setup(mode);
      fireEvent.touchStart(view.divider, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      expect(splitDragState.active).toBe(true);
      fireEvent.touchCancel(window);
      expect(splitDragState.active).toBe(false);
      fireEvent.touchMove(window, {
        touches: [{ clientX: 200, clientY: 200 }],
      });
      expect(view.changed).not.toHaveBeenCalled();
    },
  );
});

it("preserves ordinary divider movement and stops after mouseup", () => {
  const changed = vi.fn();
  const view = render(
    <SplitView
      tabs={[]}
      paneTabIds={[]}
      splitMode="2-way"
      {...defaultSizes("2-way")}
      onRowSizesChange={vi.fn()}
      onRowColSizesChange={changed}
    />,
  );
  vi.spyOn(
    view.container.firstElementChild as HTMLElement,
    "getBoundingClientRect",
  ).mockReturnValue({ width: 1000, height: 600 } as DOMRect);
  fireEvent.mouseDown(view.container.querySelector(".cursor-col-resize")!, {
    clientX: 100,
  });
  fireEvent.mouseMove(window, { clientX: 200 });
  expect(changed).toHaveBeenLastCalledWith([[60, 40]]);
  fireEvent.mouseUp(window);
  expect(splitDragState.active).toBe(false);
  changed.mockClear();
  fireEvent.mouseMove(window, { clientX: 300 });
  expect(changed).not.toHaveBeenCalled();
});
