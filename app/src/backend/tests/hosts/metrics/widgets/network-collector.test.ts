import * as runtime from "../../../../hosts/metrics/collection-runtime.js";
import type { Client } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import {
  collectNetworkMetrics,
  counterRate,
  parseNetworkCounters,
} from "../../../../hosts/metrics/widgets/network-collector.js";

const PROC_NET = `Inter-|   Receive                                                |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
  eth0: 1024 1 0 0 0 0 0 0 2048 2 0 0 0 0 0 0
    lo: 4096 4 0 0 0 0 0 0 4096 4 0 0 0 0 0 0`;

describe("network counters", () => {
  it("parses Linux proc counters", () => {
    expect(parseNetworkCounters(PROC_NET).get("eth0")).toEqual({
      rx: "1024",
      tx: "2048",
    });
  });

  it("calculates bytes per second and rejects counter resets", () => {
    expect(counterRate("1000", "2500", 0.5)).toBe(3000);
    expect(counterRate("2500", "1000", 0.5)).toBeNull();
  });
});
it("parses counters touching the interface colon without losing the interface", () => {
  const data = PROC_NET.replace("eth0: 1024", "eth0:123456789");
  expect(parseNetworkCounters(data).get("eth0")).toEqual({
    rx: "123456789",
    tx: "2048",
  });
});
it("keeps small deltas precise after counters exceed Number safe integer range", () => {
  expect(counterRate("9007199254740992", "9007199254740993", 0.5)).toBe(2);
});
it.each([NaN, Infinity, 0, -1])(
  "rejects invalid elapsed time %s",
  (elapsed) => {
    expect(counterRate("1", "2", elapsed)).toBeNull();
  },
);
it.each(["", "-1", "1.5", "Infinity", "18446744073709551616"])(
  "rejects invalid unsigned counters %s",
  (value) => {
    expect(counterRate(value, "18446744073709551615", 1)).toBeNull();
  },
);

it("measures the interval between completed samples rather than including the first SSH request twice", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const command = vi
    .spyOn(runtime, "execMetricCommand")
    .mockImplementation(async (_client, id) => {
      if (id === "network.1")
        return { stdout: "eth0 127.0.0.1/24", stderr: "", code: 0 };
      if (id === "network.2") return { stdout: "eth0 UP", stderr: "", code: 0 };
      reads++;
      const count = reads;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        stdout: PROC_NET.replace(
          "eth0: 1024",
          "eth0:" + (count === 1 ? 1000 : 2000),
        ),
        stderr: "",
        code: 0,
      };
    });
  try {
    const result = collectNetworkMetrics({} as Client);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).interfaces[0]).toMatchObject({
      name: "eth0",
      rxRateBps: 1667,
    });
  } finally {
    command.mockRestore();
    vi.useRealTimers();
  }
});
