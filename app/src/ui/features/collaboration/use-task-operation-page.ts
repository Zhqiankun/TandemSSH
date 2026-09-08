import { useEffect, useState } from "react";
import {
  collaborationApi,
  collaborationErrorCode,
} from "@/api/collaboration-api";
import type { TaskView } from "@/types/collaboration-task";
/** The selected task owns its page; stale responses cannot cross task boundaries. */
export function useTaskOperationPage(summary: TaskView | undefined) {
  const [navigation, setNavigation] = useState<{
      taskId: string;
      offset?: number;
    }>(),
    [loaded, setLoaded] = useState<{ view: TaskView; key: string }>(),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState<{ taskId: string; code: string }>();
  const id = summary?.id,
    remote = !!summary?.operationPage,
    offset =
      navigation && navigation.taskId === id ? navigation.offset : undefined;
  const latest = summary?.operationPage?.latest;
  const revision = [
    summary?.operationPage?.total,
    latest?.id,
    latest?.status,
    latest?.error,
    latest?.auditGap,
    summary?.state,
    summary?.planRevision,
    summary?.control.controlEpoch,
    summary?.policyRevision,
  ].join(":");
  const queryKey = JSON.stringify([id, offset, revision]);
  useEffect(() => {
    if (!id || !remote) return;
    const stop = new AbortController();
    let live = true;
    setLoading(true);
    setFailure(undefined);
    void collaborationApi
      .taskPage(id, offset, stop.signal)
      .then((page) => {
        if (live) setLoaded({ view: page, key: queryKey });
      })
      .catch((error) => {
        if (live)
          setFailure({ taskId: id, code: collaborationErrorCode(error) });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      stop.abort();
    };
  }, [id, remote, offset, revision, queryKey]);
  const move = (next: number | undefined) => {
    if (id) setNavigation({ taskId: id, offset: next });
  };
  if (!summary)
    return { task: undefined, loading: false, error: undefined, move };
  if (!remote) {
    const total = summary.operations.length,
      start = offset ?? Math.max(0, Math.floor((total - 1) / 50) * 50),
      operations = summary.operations.slice(start, start + 50),
      last = summary.operations.at(-1);
    return {
      task: {
        ...summary,
        operations,
        operationPage: {
          offset: start,
          total,
          succeeded: summary.operations.filter((o) => o.status === "succeeded")
            .length,
          previousOffset: start ? Math.max(0, start - 50) : null,
          nextOffset:
            start + operations.length < total
              ? start + operations.length
              : null,
          latest: last
            ? {
                id: last.id,
                status: last.status,
                error: last.error,
                auditGap: last.auditGap,
              }
            : undefined,
        },
      },
      loading: false,
      error: undefined,
      move,
    };
  }
  const detail = loaded?.view.id === id ? loaded.view : undefined;
  return {
    task: {
      ...summary,
      title: detail?.title ?? summary.title,
      commands: detail?.commands ?? summary.commands,
      plan: detail?.plan,
      fileBindings: detail?.fileBindings,
      workflowRuns: detail?.workflowRuns ?? [],
      operations: detail?.operations ?? [],
      operationPage: detail?.operationPage ?? summary.operationPage,
    },
    loading: loading || !detail || loaded?.key !== queryKey,
    error: failure?.taskId === id ? failure.code : undefined,
    move,
  };
}
