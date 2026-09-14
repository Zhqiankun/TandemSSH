import { afterEach, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import * as runtime from "../../../../hosts/metrics/collection-runtime.js";
import { collectUptimeMetrics } from "../../../../hosts/metrics/widgets/uptime-collector.js";
import { collectSystemMetrics } from "../../../../hosts/metrics/widgets/system-collector.js";
afterEach(() => vi.restoreAllMocks());
it.each([
  "",
  "-1 0",
  "NaN 0",
  "Infinity 0",
  "1e3 0",
  "123",
  "123 invalid",
  "9007199254740992 0",
  "1 2 extra",
])("keeps invalid uptime unknown: %j", async (text) => {
  vi.spyOn(runtime, "execMetricCommand").mockResolvedValue({
    stdout: text,
    stderr: "",
    code: 0,
  });
  expect(await collectUptimeMetrics({} as Client)).toEqual({
    seconds: null,
    formatted: null,
  });
});
it.each([
  ["0.00 0.00", 0, "0d 0h 0m"],
  ["90061.25 180000.00", 90061.25, "1d 1h 1m"],
] as const)("formats valid uptime %s", async (text, seconds, formatted) => {
  vi.spyOn(runtime, "execMetricCommand").mockResolvedValue({
    stdout: text,
    stderr: "",
    code: 0,
  });
  expect(await collectUptimeMetrics({} as Client)).toEqual({
    seconds,
    formatted,
  });
});
it("does not accept uptime stdout from a failed command", async () => {
  vi.spyOn(runtime, "execMetricCommand").mockResolvedValue({
    stdout: "100 200",
    stderr: "failed",
    code: 1,
  });
  expect(await collectUptimeMetrics({} as Client)).toEqual({
    seconds: null,
    formatted: null,
  });
});
it.each(["system.1", "system.2", "system.3"] as const)(
  "preserves other system fields when %s fails",
  async (failed) => {
    const outputs = {
      "system.1": "host",
      "system.2": "kernel",
      "system.3": "Linux",
    };
    vi.spyOn(runtime, "execMetricCommand").mockImplementation(
      async (_client, id) => {
        if (id === failed) throw Error("MONITORING_FAILED");
        return {
          stdout: outputs[id as keyof typeof outputs],
          stderr: "",
          code: 0,
        };
      },
    );
    expect(await collectSystemMetrics({} as Client)).toEqual({
      hostname: failed === "system.1" ? null : "host",
      kernel: failed === "system.2" ? null : "kernel",
      os: failed === "system.3" ? null : "Linux",
    });
  },
);
it("keeps unavailable system command output unknown", async () => {
  vi.spyOn(runtime, "execMetricCommand").mockResolvedValue({
    stdout: "not a valid result",
    stderr: "",
    code: 1,
  });
  expect(await collectSystemMetrics({} as Client)).toEqual({
    hostname: null,
    kernel: null,
    os: null,
  });
});
