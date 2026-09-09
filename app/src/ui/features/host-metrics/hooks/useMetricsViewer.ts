import { useCallback, useEffect, useRef } from "react";
import {
  startMetricsPolling,
  stopMetricsPolling,
} from "@/api/host-metrics-status-api";
interface ViewerLease {
  hostId: number;
  id: string;
}
/** Each window releases only its own pending/connected monitoring viewer. */
export function useMetricsViewer() {
  const current = useRef<ViewerLease | null>(null);
  const release = useCallback(async (hostId?: number) => {
    const lease = current.current;
    if (!lease || (hostId !== undefined && lease.hostId !== hostId)) return;
    current.current = null;
    await stopMetricsPolling(lease.hostId, lease.id).catch(() => {});
  }, []);
  const start = useCallback(async (hostId: number) => {
    const previous = current.current;
    const lease = { hostId, id: `viewer-${crypto.randomUUID()}` };
    current.current = lease;
    if (previous)
      await stopMetricsPolling(previous.hostId, previous.id).catch(() => {});
    if (current.current !== lease) throw Error("MONITORING_CANCELLED");
    try {
      const result = await startMetricsPolling(hostId, lease.id);
      if (current.current !== lease) {
        await stopMetricsPolling(hostId, lease.id).catch(() => {});
        throw Error("MONITORING_CANCELLED");
      }
      if (result.viewerSessionId) lease.id = result.viewerSessionId;
      return result;
    } catch (error) {
      if (current.current === lease) current.current = null;
      await stopMetricsPolling(hostId, lease.id).catch(() => {});
      throw error;
    }
  }, []);
  useEffect(
    () => () => {
      void release();
    },
    [release],
  );
  return { current, start, release };
}
