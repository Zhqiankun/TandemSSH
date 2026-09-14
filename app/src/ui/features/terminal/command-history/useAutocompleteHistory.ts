import { useCallback, useEffect, useMemo, useLayoutEffect } from "react";
import { getCommandHistory } from "@/api/command-history-api";
/** One terminal's host-scoped suggestions. Pending snapshots merge local edits. */
export function useAutocompleteHistory(hostId?: number, enabled = false) {
  const cache = useMemo(
    () => ({
      current: [] as string[],
      edits: new Map<string, boolean>(),
      active: false,
      pending: !!hostId && enabled,
      ignoreSnapshot: false,
    }),
    [hostId, enabled],
  );
  useLayoutEffect(() => {
    cache.active = true;
    return () => {
      cache.active = false;
    };
  }, [cache]);
  useEffect(() => {
    let cancelled = false;
    if (hostId && enabled) {
      cache.pending = true;
      void getCommandHistory(hostId)
        .then((rows) => {
          if (cancelled || !cache.active || cache.ignoreSnapshot) return;
          let merged = [...new Set(rows)];
          for (const [command, keep] of cache.edits) {
            merged = merged.filter((item) => item !== command);
            if (keep) merged.unshift(command);
          }
          cache.current = merged.slice(0, 500);
        })
        .catch((error) => {
          if (!cancelled && cache.active)
            console.error("Failed to load autocomplete history:", error);
        })
        .finally(() => {
          if (!cancelled) {
            cache.pending = false;
            cache.edits.clear();
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [cache, hostId, enabled]);
  const update = useCallback(
    (command: string, keep: boolean) => {
      if (!cache.active) return false;
      cache.current = cache.current.filter((item) => item !== command);
      if (keep) cache.current.unshift(command);
      cache.current = cache.current.slice(0, 500);
      if (cache.pending) {
        cache.edits.delete(command);
        cache.edits.set(command, keep);
      }
      return true;
    },
    [cache],
  );
  const add = useCallback((command: string) => update(command, true), [update]);
  const remove = useCallback(
    (command: string) => update(command, false),
    [update],
  );
  const clear = useCallback(() => {
    if (!cache.active) return false;
    cache.ignoreSnapshot = true;
    cache.pending = false;
    cache.edits.clear();
    cache.current = [];
    return true;
  }, [cache]);
  return {
    history: cache as { readonly current: string[] },
    add,
    remove,
    clear,
  };
}
