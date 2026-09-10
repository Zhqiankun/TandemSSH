import { useCallback, useEffect, useRef } from "react";
import {
  startMetricsPolling,
  stopMetricsPolling,
} from "@/api/host-metrics-status-api";
interface ViewerLease {
  hostId: number;
  id: string;
  stop: AbortController;
  ready: boolean;
}
/** Each window releases only its own pending/connected monitoring viewer. */
export function useMetricsViewer() {
  const current = useRef<ViewerLease | null>(null);
  const release = useCallback(async (hostId?: number) => {
    const lease = current.current;
    if (!lease || (hostId !== undefined && lease.hostId !== hostId)) return;
    current.current = null;
    lease.stop.abort();
    await stopMetricsPolling(lease.hostId, lease.id).catch(() => {});
  }, []);
  const start = useCallback(
    async (
      hostId: number,
    ): Promise<Awaited<ReturnType<typeof startMetricsPolling>>> => {
      const previous = current.current;
      if (previous?.hostId === hostId && previous.ready)
        return { success: true, viewerSessionId: previous.id };
      const lease = {
        hostId,
        id: `viewer-${crypto.randomUUID()}`,
        stop: new AbortController(),
        ready: false,
      };
      current.current = lease;
      if (previous) {
        previous.stop.abort();
        await stopMetricsPolling(previous.hostId, previous.id).catch(() => {});
      }
      if (current.current !== lease) throw Error("MONITORING_CANCELLED");
      try {
        const result = await startMetricsPolling(
          hostId,
          lease.id,
          lease.stop.signal,
        );
        if (current.current !== lease) {
          await stopMetricsPolling(hostId, lease.id).catch(() => {});
          throw Error("MONITORING_CANCELLED");
        }
        if (result.viewerSessionId) lease.id = result.viewerSessionId;
        lease.ready = result.success === true;
        return result;
      } catch (error) {
        const stale = current.current !== lease;
        if (!stale) current.current = null;
        lease.stop.abort();
        await stopMetricsPolling(hostId, lease.id).catch(() => {});
        if (stale) throw Error("MONITORING_CANCELLED");
        throw error;
      }
    },
    [],
  );
  useEffect(
    () => () => {
      void release();
    },
    [release],
  );
  return { current, start, release };
}
