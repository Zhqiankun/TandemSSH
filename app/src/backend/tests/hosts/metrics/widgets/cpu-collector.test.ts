import * as runtime from "../../../../hosts/metrics/collection-runtime.js";
import type { Client } from "ssh2";
import { describe, it, expect, vi } from "vitest";
import {
  collectCpuMetrics,
  parseCpuLine,
} from "../../../../hosts/metrics/widgets/cpu-collector.js";

describe("parseCpuLine", () => {
  it("parses a standard /proc/stat cpu line", () => {
    // user nice system idle iowait irq softirq
    const result = parseCpuLine("cpu  100 0 50 800 30 0 20");
    expect(result).toBeDefined();
    // idle = idle(800) + iowait(30)
    expect(result?.idle).toBe(830);
    // total = sum of all fields
    expect(result?.total).toBe(100 + 0 + 50 + 800 + 30 + 0 + 20);
  });

  it("tolerates leading/trailing whitespace", () => {
    const result = parseCpuLine("  cpu 1 2 3 4  ");
    expect(result?.total).toBe(10);
    expect(result?.idle).toBe(4);
  });

  it("returns undefined for non-cpu lines", () => {
    expect(parseCpuLine("cpu0 1 2 3 4")).toBeUndefined();
    expect(parseCpuLine("intr 12345")).toBeUndefined();
  });

  it("returns undefined when there are fewer than 4 numeric fields", () => {
    expect(parseCpuLine("cpu 1 2 3")).toBeUndefined();
  });
});
it("does not count guest time twice in the total", () => {
  expect(parseCpuLine("cpu 100 10 20 500 3 4 5 6 30 2")).toMatchObject({
    total: 648,
    idle: 503,
  });
});
it.each([
  "cpu 1 bad 2 3 4",
  "cpu 1 -2 3 4",
  "cpu 1 2.5 3 4",
  "cpu 9007199254740992 0 0 1",
])("rejects invalid counters without shifting columns: %s", (line) => {
  expect(parseCpuLine(line)).toBeUndefined();
});

it.each(["cpu.1", "cpu.2", "cpu.3"])(
  "keeps independently available samples when %s fails",
  async (failed) => {
    vi.useFakeTimers();
    let count = 0;
    const spy = vi
      .spyOn(runtime, "execMetricCommand")
      .mockImplementation(async (_client, id) => {
        if (id === failed) throw Error("unavailable");
        return {
          stdout:
            id === "cpu.2"
              ? "1.00 2.00 3.00 1/100 123"
              : id === "cpu.3"
                ? "4"
                : ++count === 1
                  ? "cpu 100 0 0 100"
                  : "cpu 150 0 0 150",
          stderr: "",
          code: 0,
        };
      });
    try {
      const pending = collectCpuMetrics({} as Client);
      await vi.advanceTimersByTimeAsync(600);
      expect(await pending).toEqual({
        percent: failed === "cpu.1" ? null : 50,
        cores: failed === "cpu.3" ? null : 4,
        load: failed === "cpu.2" ? null : [1, 2, 3],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  },
);
it("does not turn a counter decrease or malformed load into a percentage or zero", async () => {
  vi.useFakeTimers();
  let count = 0;
  const spy = vi
    .spyOn(runtime, "execMetricCommand")
    .mockImplementation(async (_client, id) => ({
      stdout:
        id === "cpu.2"
          ? "1 bad 3"
          : id === "cpu.3"
            ? "1.5"
            : ++count === 1
              ? "cpu 100 0 100 800"
              : "cpu 10 0 300 900",
      stderr: "",
      code: 0,
    }));
  try {
    const pending = collectCpuMetrics({} as Client);
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ percent: null, cores: null, load: null });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    spy.mockRestore();
    vi.useRealTimers();
  }
});
