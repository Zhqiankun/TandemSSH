import { execMetricCommand } from "../collection-runtime.js";
import type { Client } from "ssh2";

export interface NetworkCounters {
  rx: string;
  tx: string;
}

function unsignedCounter(value: string | undefined): bigint | null {
  if (value === undefined || !/^\d{1,20}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= 18446744073709551615n ? parsed : null;
}

export function parseNetworkCounters(
  output: string,
): Map<string, NetworkCounters> {
  const counters = new Map<string, NetworkCounters>();
  for (const line of output.split("\n").slice(2)) {
    const separator = line.lastIndexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const parts = line
      .slice(separator + 1)
      .trim()
      .split(/\s+/);
    if (
      name &&
      parts.length >= 16 &&
      unsignedCounter(parts[0]) !== null &&
      unsignedCounter(parts[8]) !== null
    )
      counters.set(name, { rx: parts[0], tx: parts[8] });
  }
  return counters;
}

export function counterRate(
  before: string | undefined,
  after: string | undefined,
  elapsedSeconds: number,
): number | null {
  const first = unsignedCounter(before),
    second = unsignedCounter(after);
  if (
    first === null ||
    second === null ||
    second < first ||
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0
  )
    return null;
  const delta = second - first;
  if (delta > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const rate = Math.round(Number(delta) / elapsedSeconds);
  return Number.isSafeInteger(rate) ? rate : null;
}

export async function collectNetworkMetrics(client: Client): Promise<{
  interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
    rxRateBps: number | null;
    txRateBps: number | null;
  }>;
}> {
  const interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
    rxRateBps: number | null;
    txRateBps: number | null;
  }> = [];

  try {
    const ifconfigOut = await execMetricCommand(client, "network.1");
    const netStatOut = await execMetricCommand(client, "network.2");

    const addrs = ifconfigOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const states = netStatOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const ifMap = new Map<string, { ip: string; state: string }>();
    for (const line of addrs) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const ip = parts[1].split("/")[0];
        if (!ifMap.has(name)) ifMap.set(name, { ip, state: "UNKNOWN" });
      }
    }
    for (const line of states) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        if (name === "lo") continue;
        const state = parts[1];
        const existing = ifMap.get(name);
        if (existing) {
          existing.state = state;
        } else {
          ifMap.set(name, { ip: "", state });
        }
      }
    }

    try {
      const procNet = await execMetricCommand(client, "network.3");
      const firstReadAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const procNetAfter = await execMetricCommand(client, "network.3");
      const elapsedSeconds = (Date.now() - firstReadAt) / 1000;
      const rxTxMap = parseNetworkCounters(procNet.stdout);
      const afterMap = parseNetworkCounters(procNetAfter.stdout);
      if (ifMap.size === 0) {
        for (const name of rxTxMap.keys()) {
          if (name !== "lo") ifMap.set(name, { ip: "", state: "UNKNOWN" });
        }
      }
      for (const [name, data] of ifMap.entries()) {
        const rxTx = rxTxMap.get(name);
        const after = afterMap.get(name);
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: after?.rx ?? null,
          txBytes: after?.tx ?? null,
          rxRateBps: counterRate(rxTx?.rx, after?.rx, elapsedSeconds),
          txRateBps: counterRate(rxTx?.tx, after?.tx, elapsedSeconds),
        });
      }
    } catch {
      for (const [name, data] of ifMap.entries()) {
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: null,
          txBytes: null,
          rxRateBps: null,
          txRateBps: null,
        });
      }
    }
  } catch {
    // expected
  }

  return { interfaces };
}
