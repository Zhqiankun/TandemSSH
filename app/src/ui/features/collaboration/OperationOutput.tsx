import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  collaborationApi,
  collaborationErrorCode,
} from "@/api/collaboration-api";
import type { TaskOperation } from "@/types/collaboration-task";
export function OperationOutput({
  taskId,
  operation,
  open,
}: {
  taskId: string;
  operation: TaskOperation;
  open: boolean;
}) {
  const { t } = useTranslation(),
    [full, setFull] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const owner = useRef({ live: true, stop: new AbortController() });
  useEffect(() => {
    const current = { live: true, stop: new AbortController() };
    owner.current = current;
    return () => {
      current.live = false;
      current.stop.abort();
    };
  }, [taskId, operation.id]);
  const expand = async () => {
    const current = owner.current;
    setBusy(true);
    setError(undefined);
    try {
      const detail = await collaborationApi.operationDetail(
        taskId,
        operation.id,
        current.stop.signal,
      );
      if (current.live) setFull(detail.output ?? "");
    } catch (e) {
      if (current.live) setError(collaborationErrorCode(e));
    } finally {
      if (current.live) setBusy(false);
    }
  };
  if (!operation.output && !operation.outputTruncated) return null;
  return (
    <details open={open}>
      <summary>{t("tandem.collaboration.output")}</summary>
      <pre>{full ?? operation.output}</pre>
      {operation.outputTruncated && full === undefined && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void expand()}
        >
          {t("tandem.history.fullOutput")}
        </Button>
      )}
      {error && (
        <p role="alert">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.history.failed"),
          })}
        </p>
      )}
    </details>
  );
}
