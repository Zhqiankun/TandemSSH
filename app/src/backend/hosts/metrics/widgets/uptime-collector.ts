import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

export async function collectUptimeMetrics(client: Client): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  let uptimeSeconds: number | null = null;
  let uptimeFormatted: string | null = null;

  try {
    const uptimeOut = await execMetricCommand(client, "uptime.1");
    const uptimeParts = uptimeOut.stdout.trim().split(/\s+/);
    if (uptimeParts.length >= 1) {
      uptimeSeconds = Number(uptimeParts[0]);
      if (Number.isFinite(uptimeSeconds)) {
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        uptimeFormatted = `${days}d ${hours}h ${minutes}m`;
      }
    }
  } catch {
    // expected
  }

  return {
    seconds: uptimeSeconds,
    formatted: uptimeFormatted,
  };
}
