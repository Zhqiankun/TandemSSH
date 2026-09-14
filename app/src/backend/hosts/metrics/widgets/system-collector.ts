import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

export async function collectSystemMetrics(client: Client): Promise<{
  hostname: string | null;
  kernel: string | null;
  os: string | null;
}> {
  const [hostname, kernel, os] = await Promise.all(
    (["system.1", "system.2", "system.3"] as const).map(async (command) => {
      try {
        const result = await execMetricCommand(client, command);
        return result.code === 0 ? result.stdout.trim() || null : null;
      } catch {
        return null;
      }
    }),
  );
  return { hostname, kernel, os };
}
