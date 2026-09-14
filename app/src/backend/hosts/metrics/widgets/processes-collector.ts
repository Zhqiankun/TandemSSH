import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

function processCount(output: string, header = false): number | null {
  const text = output.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < (header ? 1 : 0)) return null;
  return value - (header ? 1 : 0);
}

export async function collectProcessesMetrics(client: Client): Promise<{
  total: number | null;
  running: number | null;
  top: Array<{
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    command: string;
  }>;
}> {
  let totalProcesses: number | null = null;
  let runningProcesses: number | null = null;
  const topProcesses: Array<{
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    command: string;
  }> = [];

  try {
    const psOut = await execMetricCommand(client, "processes.1");
    const psLines = psOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (psLines.length > 1) {
      const busybox = /^PID\s+USER\s+TIME\s+COMMAND$/.test(psLines[0]);
      for (let i = 1; i < Math.min(psLines.length, 11); i++) {
        const parts = psLines[i].split(/\s+/);
        if (busybox && parts.length >= 4 && /^\d+$/.test(parts[0])) {
          topProcesses.push({
            pid: parts[0],
            user: parts[1],
            cpu: "—",
            mem: "—",
            command: parts.slice(3).join(" ").substring(0, 50),
          });
        } else if (parts.length >= 11) {
          const cpuVal = Number(parts[2]);
          const memVal = Number(parts[3]);
          if (
            !/^\d+$/.test(parts[1]) ||
            !Number.isFinite(cpuVal) ||
            cpuVal < 0 ||
            !Number.isFinite(memVal) ||
            memVal < 0
          )
            continue;
          topProcesses.push({
            pid: parts[1],
            user: parts[0],
            cpu: cpuVal.toString(),
            mem: memVal.toString(),
            command: parts.slice(10).join(" ").substring(0, 50),
          });
        }
      }
    }
  } catch {
    // Other process samples may still be available.
  }
  try {
    const sample = await execMetricCommand(client, "processes.2");
    totalProcesses = processCount(sample.stdout, true);
  } catch {
    /* Missing samples remain unknown. */
  }
  try {
    const sample = await execMetricCommand(client, "processes.3");
    runningProcesses = processCount(sample.stdout);
  } catch {
    /* Preserve an independently collected total. */
  }

  return {
    total: totalProcesses,
    running: runningProcesses,
    top: topProcesses,
  };
}
