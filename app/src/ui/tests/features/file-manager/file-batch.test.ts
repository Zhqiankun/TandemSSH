import { expect, it, vi } from "vitest";
import {
  runFileBatch,
  assertFileSession,
} from "../../../features/file-manager/file-batch";
it("keeps confirmed items and stops after a lost response without retrying", async () => {
  const changed: string[] = [],
    error = Error("response lost");
  const action = vi.fn(async (item: string) => {
    changed.push(item);
    if (item === "second") throw error;
  });
  expect(await runFileBatch(["first", "second", "third"], action)).toEqual({
    ok: false,
    completed: 1,
    error,
  });
  expect(changed).toEqual(["first", "second"]);
  expect(action).toHaveBeenCalledTimes(2);
});
it("counts only acknowledged actions and handles empty batches", async () => {
  const order: number[] = [];
  expect(
    await runFileBatch([1, 2], async (n) => {
      order.push(n);
    }),
  ).toEqual({ ok: true, completed: 2 });
  expect(order).toEqual([1, 2]);
  const action = vi.fn();
  expect(await runFileBatch([], action)).toEqual({ ok: true, completed: 0 });
  expect(action).not.toHaveBeenCalled();
});
it("stops later file actions after the selected connection changes", async () => {
  let current = "original";
  const writes: number[] = [];
  const result = await runFileBatch([1, 2, 3], async (item) => {
    assertFileSession("original", current);
    writes.push(item);
    current = "replacement";
  });
  expect(result).toMatchObject({
    ok: false,
    completed: 1,
    error: expect.objectContaining({ message: "FILE_SESSION_CHANGED" }),
  });
  expect(writes).toEqual([1]);
  expect(() => assertFileSession("original", null)).toThrow(
    "FILE_SESSION_CHANGED",
  );
});
