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

it.each(["switch", "unmount"] as const)(
  "does not start a stale confirmed delete batch after %s",
  async (reason) => {
    const action = vi.fn();
    const result = await runFileBatch(["first", "second"], action, () =>
      assertFileSession(
        "original",
        reason === "switch" ? "replacement" : "original",
        reason !== "unmount",
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      completed: 0,
      error: expect.objectContaining({ message: "FILE_SESSION_CHANGED" }),
    });
    expect(action).not.toHaveBeenCalled();
  },
);
it.each(["switch", "unmount"] as const)(
  "counts a confirmed in-flight deletion but prevents the next after %s",
  async (reason) => {
    let current = "original",
      mounted = true;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = vi.fn(async () => pending);
    const result = runFileBatch(["first", "second", "third"], action, () =>
      assertFileSession("original", current, mounted),
    );
    expect(action).toHaveBeenCalledTimes(1);
    if (reason === "switch") current = "replacement";
    else mounted = false;
    release();
    expect(await result).toMatchObject({
      ok: false,
      completed: 1,
      error: expect.objectContaining({ message: "FILE_SESSION_CHANGED" }),
    });
    expect(action).toHaveBeenCalledTimes(1);
  },
);
