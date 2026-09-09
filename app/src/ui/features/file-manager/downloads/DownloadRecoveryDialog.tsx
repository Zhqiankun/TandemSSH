import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { downloadRecoveryApi } from "@/api/download-recovery-api";
import { downloadErrorCode } from "@/api/file-download-api";
import type { DownloadRecoverySummary } from "@/types/download-recovery";
import type { DownloadQueue } from "./queue";
export function DownloadRecoveryDialog({
  sessionId,
  hostId,
  queue,
}: {
  sessionId?: string;
  hostId?: number;
  queue: DownloadQueue;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<DownloadRecoverySummary[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [discard, setDiscard] = useState<string>(),
    [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open || !sessionId) return;
    let live = true;
    setBusy(true);
    setError(undefined);
    setRows([]);
    void downloadRecoveryApi
      .list(sessionId)
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((e) => {
        if (live) setError(downloadErrorCode(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [open, sessionId, revision]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      setRevision((n) => n + 1);
    } catch (e) {
      setError(downloadErrorCode(e));
    } finally {
      setBusy(false);
    }
  };
  if (!window.electronAPI?.downloads?.recovery) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("downloadRecovery.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("downloadRecovery.title")}</DialogTitle>
            <DialogDescription>{t("downloadRecovery.hint")}</DialogDescription>
          </DialogHeader>
          {!sessionId && <p>{t("downloadRecovery.connectFirst")}</p>}
          {busy && <p role="status">{t("downloadRecovery.busy")}</p>}
          {error && (
            <p role="alert" className="text-amber-500">
              {t("downloadRecovery.errors." + error, {
                defaultValue: t("tandem.download.errors." + error, {
                  defaultValue: t("downloadRecovery.failed"),
                }),
              })}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !sessionId}
            onClick={() => setRevision((n) => n + 1)}
          >
            {t("common.refresh")}
          </Button>
          {!busy && sessionId && !rows.length && !error && (
            <p>{t("downloadRecovery.empty")}</p>
          )}
          {rows.map((row) => (
            <article
              key={row.id}
              className="rounded border border-border p-3 text-sm space-y-2"
            >
              <div className="flex justify-between gap-3">
                <strong className="break-all">
                  {row.hostLabel ?? t("downloadRecovery.unreadable")}
                </strong>
                <span>{t("downloadRecovery.states." + row.state)}</span>
              </div>
              {row.error && (
                <p role="alert">
                  {t("downloadRecovery.errors." + row.error, {
                    defaultValue: t("downloadRecovery.failed"),
                  })}
                </p>
              )}
              <p className="break-all select-text">{row.path}</p>
              <p className="break-all select-text">{row.localPath}</p>
              {row.size !== undefined && (
                <p>
                  {t("downloadRecovery.progress", {
                    bytes: row.writtenBytes,
                    total: row.size,
                  })}
                </p>
              )}
              {["available", "interrupted"].includes(row.state) && (
                <>
                  {row.existing && (
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={!!overwrite[row.id]}
                        onChange={(e) =>
                          setOverwrite((old) => ({
                            ...old,
                            [row.id]: e.target.checked,
                          }))
                        }
                      />
                      {t("downloadRecovery.overwrite")}
                    </label>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy || !sessionId || (row.existing && !overwrite[row.id])
                    }
                    onClick={() =>
                      void act(async () => {
                        const reservation = queue.reserveRecovery();
                        try {
                          const result = await downloadRecoveryApi.restore(
                            sessionId!,
                            row.id,
                            !!overwrite[row.id],
                          );
                          reservation.accept(result, hostId);
                        } finally {
                          reservation.close();
                        }
                        setOpen(false);
                      })
                    }
                  >
                    {t("downloadRecovery.restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDiscard(row.id)}
                  >
                    {t("downloadRecovery.discard")}
                  </Button>
                  {discard === row.id && (
                    <div>
                      <p>{t("downloadRecovery.discardHint")}</p>
                      <Button
                        size="sm"
                        disabled={busy || !sessionId}
                        onClick={() =>
                          void act(async () => {
                            await downloadRecoveryApi.discard(
                              sessionId!,
                              row.id,
                            );
                            setDiscard(undefined);
                          })
                        }
                      >
                        {t("downloadRecovery.confirmDiscard")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDiscard(undefined)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  )}
                </>
              )}
              {["unknown", "committing"].includes(row.state) && (
                <>
                  <p>{t("downloadRecovery.unknown")}</p>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void act(async () => {
                        const result = await downloadRecoveryApi.check(
                          sessionId!,
                          row.id,
                        );
                        queue.reconcileRecovery(row.id, result.local);
                      })
                    }
                  >
                    {t("downloadRecovery.check")}
                  </Button>
                </>
              )}
              {["completed", "cancelled"].includes(row.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !sessionId}
                  onClick={() =>
                    void act(async () => {
                      await downloadRecoveryApi.remove(sessionId!, row.id);
                    })
                  }
                >
                  {t("downloadRecovery.remove")}
                </Button>
              )}
            </article>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
