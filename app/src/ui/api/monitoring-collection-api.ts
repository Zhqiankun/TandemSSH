import { statsApi } from "@/main-axios";
import type { MonitoringSnapshot } from "@/types/monitoring";
export async function getMonitoringCollection(
  hostId: number,
  signal?: AbortSignal,
): Promise<MonitoringSnapshot> {
  const result = await statsApi.get(`/metrics/collection/${hostId}`, {
    signal,
  });
  return result.data;
}
export async function controlMonitoringCollection(
  hostId: number,
  action: "pause" | "resume",
): Promise<MonitoringSnapshot> {
  const result = await statsApi.post(`/metrics/collection/${hostId}`, {
    action,
  });
  return result.data;
}
