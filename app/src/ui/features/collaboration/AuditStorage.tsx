import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { taskHistoryApi } from "@/api/task-history-api";
import type {
  AuditCleanupResult,
  AuditStorageInfo,
} from "@/types/task-history";

export function AuditStorage({ onClean }: { onClean: () => void }) {
  const { t } = useTranslation(),
    epoch = useRef(Symbol());
  const [info, setInfo] = useState<AuditStorageInfo>(),
    [busy, setBusy] = useState(true);
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState(false);
  const [result, setResult] = useState<AuditCleanupResult>();
  useEffect(() => {
    const request = Symbol();
    epoch.current = request;
    void taskHistoryApi
      .storage()
      .then((value) => {
        if (epoch.current === request) setInfo(value);
      })
      .catch(() => {
        if (epoch.current === request) setError(true);
      })
      .finally(() => {
        if (epoch.current === request) setBusy(false);
      });
    return () => {
      epoch.current = Symbol();
    };
  }, []);
  const clean = async () => {
    const request = Symbol();
    epoch.current = request;
    setBusy(true);
    setError(false);
    setResult(undefined);
    try {
      const outcome = await taskHistoryApi.cleanup();
      if (epoch.current !== request) return;
      setResult(outcome);
      setConfirm(false);
      onClean();
      const refreshed = await taskHistoryApi.storage();
      if (epoch.current === request) setInfo(refreshed);
    } catch {
      if (epoch.current === request) setError(true);
    } finally {
      if (epoch.current === request) setBusy(false);
    }
  };
  return (
    <section
      className="space-y-2 border border-border p-3"
      aria-label={t("tandem.history.storageTitle")}
    >
      <p className="text-sm font-semibold">
        {t("tandem.history.storageTitle")}
      </p>
      {info && (
        <>
          <label className="block text-xs">
            {t("tandem.history.storagePath")}
            <input
              readOnly
              value={info.directory}
              className="mt-1 w-full border border-border bg-background px-2 py-1 text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t("tandem.history.storageUsage", {
              files: info.files,
              mib: (info.bytes / 1048576).toFixed(2),
              days: info.retentionDays,
              max: Math.round(info.maxBytes / 1048576),
            })}
          </p>
          {!confirm ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {t("tandem.history.cleanupRetention")}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs">{t("tandem.history.cleanupConfirm")}</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void clean()}>
                  {t("tandem.history.confirmCleanup")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {result && (
        <p role="status" className="text-xs">
          {t("tandem.history.cleanupResult", {
            files: result.removedFiles,
            kib: Math.ceil(result.removedBytes / 1024),
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-amber-500">
          {t("tandem.history.storageError")}
        </p>
      )}
    </section>
  );
}
