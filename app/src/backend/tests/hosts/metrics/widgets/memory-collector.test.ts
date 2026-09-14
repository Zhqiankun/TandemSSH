import { afterEach, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import * as runtime from "../../../../hosts/metrics/collection-runtime.js";
import { collectMemoryMetrics } from "../../../../hosts/metrics/widgets/memory-collector.js";
afterEach(() => vi.restoreAllMocks());
async function collect(text: string) {
  vi.spyOn(runtime, "execMetricCommand").mockResolvedValue({
    stdout: text,
    stderr: "",
    code: 0,
  });
  return collectMemoryMetrics({} as Client);
}
it("reports fully used memory when available memory is zero", async () => {
  expect(await collect("MemTotal: 1048576 kB\nMemAvailable: 0 kB\n")).toEqual({
    percent: 100,
    usedGiB: 1,
    totalGiB: 1,
  });
});
it("preserves legitimate zero used memory", async () => {
  expect(
    await collect("MemTotal: 1048576 kB\nMemAvailable: 1048576 kB\n"),
  ).toEqual({ percent: 0, usedGiB: 0, totalGiB: 1 });
});
it.each([
  "-1 kB",
  "1.5 kB",
  "100 MB",
  "9007199254740992 kB",
  "2097152 kB",
  "NaN kB",
  "",
])("does not invent usage from invalid available value %s", async (value) => {
  expect(await collect("MemTotal: 1048576 kB\nMemAvailable: " + value)).toEqual(
    { percent: null, usedGiB: null, totalGiB: 1 },
  );
});
it.each(["0 kB", "-1 kB", "1.5 kB", "1048576 MB", "9007199254740992 kB", ""])(
  "rejects invalid total %s",
  async (value) => {
    expect(
      await collect("MemTotal: " + value + "\nMemAvailable: 0 kB"),
    ).toEqual({ percent: null, usedGiB: null, totalGiB: null });
  },
);
it("retains total when availability is absent or ambiguous", async () => {
  expect(await collect("MemTotal: 1048576 kB\n")).toEqual({
    percent: null,
    usedGiB: null,
    totalGiB: 1,
  });
  vi.restoreAllMocks();
  expect(
    await collect(
      "MemTotal: 1048576 kB\nMemAvailable: 0 kB\nMemAvailable: 100 kB",
    ),
  ).toEqual({ percent: null, usedGiB: null, totalGiB: 1 });
});
it("reads normal tab-separated CRLF samples", async () => {
  expect(
    await collect("MemTotal:\t1048576 kB\r\nMemAvailable:\t524288 kB\r\n"),
  ).toEqual({ percent: 50, usedGiB: 0.5, totalGiB: 1 });
});
it("keeps unavailable reads unknown", async () => {
  vi.spyOn(runtime, "execMetricCommand").mockRejectedValue(
    Error("MONITORING_FAILED"),
  );
  expect(await collectMemoryMetrics({} as Client)).toEqual({
    percent: null,
    usedGiB: null,
    totalGiB: null,
  });
});
