import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

export async function collectUptimeMetrics(client: Client): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  try {
    const result = await execMetricCommand(client, "uptime.1");
    const text = result.stdout.trim();
    if (result.code !== 0 || !/^\d+(?:\.\d+)?[ \t]+\d+(?:\.\d+)?$/.test(text))
      return { seconds: null, formatted: null };
    const values = text.split(/[ \t]+/).map(Number);
    if (
      values.some(
        (value) => !Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER,
      )
    )
      return { seconds: null, formatted: null };
    const seconds = values[0];
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return { seconds, formatted: `${days}d ${hours}h ${minutes}m` };
  } catch {
    return { seconds: null, formatted: null };
  }
}
