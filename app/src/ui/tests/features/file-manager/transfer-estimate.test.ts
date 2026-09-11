import { expect, it } from "vitest";
import { estimateTransfer } from "../../../features/file-manager/transfer-estimate";
it("estimates remaining bytes and displays positive low speeds without rounding to zero", () => {
  expect(estimateTransfer(4096, 1024, 1024)).toEqual({ speed: 1, seconds: 3 });
  expect(estimateTransfer(10, 2, 1)).toEqual({ speed: 0.000977, seconds: 8 });
  expect(estimateTransfer(0, 0, 1)?.seconds).toBe(0);
  expect(estimateTransfer(10, 10, 1)?.seconds).toBe(0);
});
it("does not invent ETA for missing, inconsistent or nonfinite measurements", () => {
  for (const [total, done, speed] of [
    [undefined, 1, 100],
    [10, 11, 100],
    [10, -1, 100],
    [-1, 0, 100],
    [10, 0, 0],
    [10, 0, -1],
    [10, 0, NaN],
    [10, 0, Infinity],
    [10, 0, undefined],
    [Infinity, 0, 100],
    [10, NaN, 100],
    [Number.MAX_SAFE_INTEGER, 0, Number.MIN_VALUE],
  ] as const)
    expect(estimateTransfer(total, done, speed)).toBeUndefined();
});
