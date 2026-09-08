import { useCallback, useEffect, useRef, useState } from "react";
import {
  collaborationApi,
  collaborationErrorCode,
} from "@/api/collaboration-api";
import type { TaskView } from "@/types/collaboration-task";
type Snapshot = Awaited<ReturnType<typeof collaborationApi.snapshot>>;
export function useTaskWorkbench(sessionId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const errorScope = useRef(0);
  const clearActionError = useCallback(() => {
    errorScope.current++;
    setError(undefined);
  }, []);
  const [connectionError, setConnectionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0),
    alive = useRef(true),
    takingOver = useRef(false);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++sequence.current;
      try {
        const next = await collaborationApi.snapshot(sessionId, signal);
        if (alive.current && version === sequence.current) {
          setSnapshot(next);
          setConnectionError(undefined);
        }
      } catch (error) {
        if (!signal?.aborted && alive.current && version === sequence.current)
          setConnectionError(collaborationErrorCode(error));
      }
    },
    [sessionId],
  );
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      await refresh(controller.signal);
      if (!stopped) timer = setTimeout(poll, 800);
    }
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<TaskView>) => {
    const scope = errorScope.current;
    setBusy(true);
    setError(undefined);
    try {
      const task = await action();
      if (alive.current)
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                tasks: [
                  ...previous.tasks.filter((t) => t.id !== task.id),
                  task,
                ],
              }
            : previous,
        );
      await refresh();
      return task;
    } catch (error) {
      if (alive.current && scope === errorScope.current)
        setError(collaborationErrorCode(error));
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  // Takeover stays available while an authorization or command request is pending.
  const takeover = async () => {
    if (takingOver.current) return;
    const scope = errorScope.current;
    takingOver.current = true;
    setTakeoverPending(true);
    try {
      await collaborationApi.takeover(sessionId);
      await refresh();
    } catch (error) {
      if (alive.current && scope === errorScope.current)
        setError(collaborationErrorCode(error));
    } finally {
      takingOver.current = false;
      if (alive.current) setTakeoverPending(false);
    }
  };
  return {
    snapshot,
    clearActionError,
    error: error ?? connectionError,
    busy,
    run,
    takeover,
    takeoverPending,
  };
}
