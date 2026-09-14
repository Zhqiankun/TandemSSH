import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";
import { toFixedNum } from "./common-utils.js";

export function parseCpuLine(
  cpuLine: string,
): { total: number; idle: number; counters: number[] } | undefined {
  const parts = cpuLine.trim().split(/\s+/);
  if (parts[0] !== "cpu" || parts.length < 5) return undefined;
  const values = parts.slice(1);
  if (!values.every((value) => /^\d+$/.test(value))) return undefined;
  const nums = values.map(Number);
  if (!nums.every(Number.isSafeInteger)) return undefined;
  // Linux guest and guest_nice are already charged to user and nice.
  const counters = Array.from({ length: 8 }, (_, index) => nums[index] ?? 0);
  const total = counters.reduce((sum, value) => sum + value, 0),
    idle = counters[3] + counters[4];
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(idle))
    return undefined;
  return { total, idle, counters };
}

export async function collectCpuMetrics(
  client: Client,
): Promise<{
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}> {
  let cpuPercent: number | null = null,
    cores: number | null = null,
    loadTriplet: [number, number, number] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [stat1, loadAvgOut, coresOut] = await Promise.race([
      Promise.all([
        execMetricCommand(client, "cpu.1").catch(() => null),
        execMetricCommand(client, "cpu.2").catch(() => null),
        execMetricCommand(client, "cpu.3").catch(() => null),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("CPU metrics collection timeout")),
          25000,
        );
        timer.unref?.();
      }),
    ]);
    const laParts = loadAvgOut?.stdout.trim().split(/\s+/).slice(0, 3) ?? [];
    if (
      laParts.length === 3 &&
      laParts.every(
        (value) =>
          /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)),
      )
    )
      loadTriplet = laParts.map(Number) as [number, number, number];
    const coreText = coresOut?.stdout.trim() ?? "",
      coreValue = Number(coreText);
    if (
      /^\d+$/.test(coreText) &&
      Number.isSafeInteger(coreValue) &&
      coreValue > 0
    )
      cores = coreValue;
    if (stat1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const stat2 = await execMetricCommand(client, "cpu.1");
      const line = (output: string) =>
        output.split("\n").find((value) => /^\s*cpu\s/.test(value)) ?? "";
      const first = parseCpuLine(line(stat1.stdout)),
        second = parseCpuLine(line(stat2.stdout));
      if (
        first &&
        second &&
        second.counters.every((value, index) => value >= first.counters[index])
      ) {
        const total = second.total - first.total,
          idle = second.idle - first.idle;
        if (total > 0 && idle >= 0 && idle <= total)
          cpuPercent = ((total - idle) / total) * 100;
      }
    }
  } catch {
    cpuPercent = null;
  } finally {
    clearTimeout(timer);
  }
  return { percent: toFixedNum(cpuPercent, 0), cores, load: loadTriplet };
}
