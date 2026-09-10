import { expect, it } from "vitest";
import { fitFileWindow } from "@/features/file-manager/components/window-geometry";
it("fits the observed oversized editor to its container", () => {
  expect(
    fitFileWindow(
      { x: 390, y: 260, width: 900, height: 660 },
      { width: 800, height: 650 },
      { width: 400, height: 300 },
    ),
  ).toEqual({ x: 0, y: 49, width: 800, height: 601 });
});
it("keeps an already visible window where the user put it", () => {
  const rect = { x: 80, y: 100, width: 500, height: 300 };
  expect(
    fitFileWindow(
      rect,
      { width: 900, height: 700 },
      { width: 400, height: 300 },
    ),
  ).toEqual(rect);
});
it("prioritizes visible controls when the container is smaller than minimum sizes", () => {
  expect(
    fitFileWindow(
      { x: -50, y: 900, width: 900, height: 660 },
      { width: 250, height: 200 },
      { width: 400, height: 300 },
    ),
  ).toEqual({ x: 0, y: 0, width: 250, height: 200 });
});
it("defers fitting hidden containers and remains stable after fitting", () => {
  const rect = { x: 300, y: 200, width: 900, height: 660 },
    minimum = { width: 400, height: 300 };
  expect(fitFileWindow(rect, { width: 0, height: 0 }, minimum)).toBe(rect);
  const fitted = fitFileWindow(rect, { width: 700, height: 500 }, minimum);
  expect(fitFileWindow(fitted, { width: 700, height: 500 }, minimum)).toEqual(
    fitted,
  );
});
