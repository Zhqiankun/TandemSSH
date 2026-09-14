import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";
import { toFixedNum, kibToGiB } from "./common-utils.js";

export async function collectMemoryMetrics(client: Client): Promise<{
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}> {
  let memPercent: number | null = null;
  let usedGiB: number | null = null;
  let totalGiB: number | null = null;

  try {
    const memInfo = await execMetricCommand(client, "memory.1");
    const lines = memInfo.stdout.split("\n").map((line) => line.trim());
    const getVal = (key: string): number | null => {
      const matches = lines.filter((line) => line.startsWith(key));
      if (matches.length !== 1) return null;
      const parsed = matches[0].slice(key.length).match(/^\s*(\d+)\s+kB\s*$/);
      if (!parsed) return null;
      const value = Number(parsed[1]);
      return Number.isSafeInteger(value) ? value : null;
    };
    const totalKb = getVal("MemTotal:");
    const availKb = getVal("MemAvailable:");
    if (totalKb !== null && totalKb > 0) {
      totalGiB = kibToGiB(totalKb);
      if (availKb !== null && availKb <= totalKb) {
        const usedKb = totalKb - availKb;
        memPercent = (usedKb / totalKb) * 100;
        usedGiB = kibToGiB(usedKb);
      }
    }
  } catch {
    memPercent = null;
    usedGiB = null;
    totalGiB = null;
  }

  return {
    percent: toFixedNum(memPercent, 0),
    usedGiB: toFixedNum(usedGiB, 2),
    totalGiB: toFixedNum(totalGiB, 2),
  };
}
