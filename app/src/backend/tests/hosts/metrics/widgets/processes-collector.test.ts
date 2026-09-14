import { afterEach, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import * as runtime from "../../../../hosts/metrics/collection-runtime.js";
import { collectProcessesMetrics } from "../../../../hosts/metrics/widgets/processes-collector.js";
const sample =
  "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\nroot 7 1.2 0.3 0 0 ? R+ 00:00 00:01 测试程序 --flag";
function fixture(total: string, running: string, fail?: string) {
  vi.spyOn(runtime, "execMetricCommand").mockImplementation(
    async (_client, id) => {
      if (id === fail) throw Error("fixture unavailable");
      return {
        stdout:
          id === "processes.1"
            ? sample
            : id === "processes.2"
              ? total
              : running,
        stderr: "",
        code: 0,
      };
    },
  );
}
afterEach(() => vi.restoreAllMocks());
it("returns unknown counts for missing output instead of negative or false zero", async () => {
  fixture("", "");
  expect(await collectProcessesMetrics({} as Client)).toMatchObject({
    total: null,
    running: null,
  });
});
it("retains a valid total if running-process sampling fails", async () => {
  fixture("11", "", "processes.3");
  expect(await collectProcessesMetrics({} as Client)).toMatchObject({
    total: 10,
    running: null,
  });
});
it("collects counts even when the top process sample is unavailable", async () => {
  fixture("11", "2", "processes.1");
  expect(await collectProcessesMetrics({} as Client)).toEqual({
    total: 10,
    running: 2,
    top: [],
  });
});
it("retains valid process metadata and zero running processes", async () => {
  fixture("2", "0");
  expect(await collectProcessesMetrics({} as Client)).toEqual({
    total: 1,
    running: 0,
    top: [
      {
        pid: "7",
        user: "root",
        cpu: "1.2",
        mem: "0.3",
        command: "测试程序 --flag",
      },
    ],
  });
});
it.each(["-1", "1.5", "NaN", "9007199254740992"])(
  "rejects invalid process counts %s",
  async (value) => {
    fixture(value, value);
    expect(await collectProcessesMetrics({} as Client)).toMatchObject({
      total: null,
      running: null,
    });
  },
);

it("preserves BusyBox process identity without inventing unavailable percentages", async () => {
  fixture("3", "1");
  vi.mocked(runtime.execMetricCommand).mockResolvedValueOnce({
    stdout:
      "PID   USER     TIME  COMMAND\n1 root 0:03 /sbin/init\n7 alpine 0:00 sh -c 中文参数",
    stderr: "",
    code: 0,
  });
  expect((await collectProcessesMetrics({} as Client)).top).toEqual([
    { pid: "1", user: "root", cpu: "—", mem: "—", command: "/sbin/init" },
    { pid: "7", user: "alpine", cpu: "—", mem: "—", command: "sh -c 中文参数" },
  ]);
});
