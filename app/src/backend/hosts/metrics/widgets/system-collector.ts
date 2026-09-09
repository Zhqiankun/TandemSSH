import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

export async function collectSystemMetrics(client: Client): Promise<{
  hostname: string | null;
  kernel: string | null;
  os: string | null;
}> {
  let hostname: string | null = null;
  let kernel: string | null = null;
  let os: string | null = null;

  try {
    const hostnameOut = await execMetricCommand(client, "system.1");
    const kernelOut = await execMetricCommand(client, "system.2");
    const osOut = await execMetricCommand(client, "system.3");

    hostname = hostnameOut.stdout.trim() || null;
    kernel = kernelOut.stdout.trim() || null;
    os = osOut.stdout.trim() || null;
  } catch {
    // expected
  }

  return {
    hostname,
    kernel,
    os,
  };
}
