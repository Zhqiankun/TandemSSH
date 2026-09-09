import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { downloadBatchRecoveryApi } from "@/api/download-batch-recovery-api";
import {
  downloadErrorCode,
  nativeDownloadValue,
} from "@/api/file-download-api";
import { downloadBatches, type DownloadBatches } from "./download-batches";
import type {
  DownloadBatchSummary,
  DownloadBatchDetail,
} from "@/types/download-batch-recovery";
export function DownloadBatchRecoveryDialog({
  sessionId,
  hostId,
  batches = downloadBatches,
}: {
  sessionId?: string;
  hostId?: number;
  batches?: DownloadBatches;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<DownloadBatchSummary[]>([]),
    [detail, setDetail] = useState<DownloadBatchDetail>(),
    [reviewed, setReviewed] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [discard, setDiscard] = useState(false),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const live = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      if (live.current) setError(downloadErrorCode(e));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const refresh = async () => {
    if (!sessionId) return;
    const result = await downloadBatchRecoveryApi.list(sessionId);
    if (live.current) setRows(result);
  };
  const select = async (id: string) => {
    setDetail(undefined);
    setReviewed(false);
    setOverwrite(false);
    setDiscard(false);
    setPage(0);
    const result = await downloadBatchRecoveryApi.detail(sessionId!, id);
    if (live.current) setDetail(result);
  };
  if (!window.electronAPI?.downloadDirectories?.recovery) return null;
  const row = detail?.summary,
    entries = detail?.entries ?? [],
    pages = Math.max(1, Math.ceil(entries.length / 50));
  const restorable = row && ["available", "interrupted"].includes(row.state);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        {t("downloadBatchRecovery.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending.current) {
            setOpen(v);
            if (!v) {
              setDetail(undefined);
              setError(undefined);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("downloadBatchRecovery.title")}</DialogTitle>
            <DialogDescription>
              {t("downloadBatchRecovery.hint")}
            </DialogDescription>
          </DialogHeader>
          {!sessionId && <p>{t("downloadBatchRecovery.connect")}</p>}
          {busy && <p role="status">{t("downloadBatchRecovery.busy")}</p>}
          {error && (
            <p role="alert" className="text-amber-500">
              {t("downloadBatchRecovery.errors." + error, {
                defaultValue: t("downloadRecovery.errors." + error, {
                  defaultValue: t("tandem.download.errors." + error, {
                    defaultValue: t("downloadBatchRecovery.failed"),
                  }),
                }),
              })}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !sessionId}
            onClick={() =>
              void run(async () => {
                await refresh();
                if (row) await select(row.id);
              })
            }
          >
            {t("common.refresh")}
          </Button>
          {!busy && sessionId && !rows.length && !error && (
            <p>{t("downloadBatchRecovery.empty")}</p>
          )}
          <div className="space-y-2">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                aria-pressed={row?.id === r.id}
                className="block w-full rounded border border-border p-3 text-left text-sm disabled:opacity-60 aria-pressed:border-primary"
                onClick={() => void run(() => select(r.id))}
              >
                <span className="flex justify-between gap-3">
                  <strong className="break-all">{r.name}</strong>
                  <span>{t("downloadBatchRecovery.states." + r.state)}</span>
                </span>
                <span className="block break-all">
                  {r.hostLabel} · {r.localPath}
                </span>
                <span className="block">
                  {t("downloadBatchRecovery.progress", {
                    completed: r.completed,
                    total: r.entries,
                    paused: r.paused,
                    unknown: r.unknown,
                  })}
                </span>
              </button>
            ))}
          </div>
          {row && (
            <section className="border-t border-border pt-3 space-y-3">
              <h3 className="font-medium">{t("downloadBatchRecovery.plan")}</h3>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left">
                        {t("downloadBatchRecovery.target")}
                      </th>
                      <th className="text-left">
                        {t("downloadBatchRecovery.result")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(page * 50, (page + 1) * 50).map((e) => (
                      <tr key={e.id}>
                        <td className="p-1 break-all">
                          {e.path ?? e.relativePath}
                        </td>
                        <td className="p-1">
                          {t(
                            "downloadBatchRecovery.entryStates." +
                              (e.result?.state ??
                                detail?.members.find((m) => m.entryId === e.id)
                                  ?.state ??
                                e.action ??
                                "pending"),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!page || busy}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t("tandem.downloadTree.previous")}
                  </Button>
                  <span>
                    {page + 1} / {pages}
                  </span>
                  <Button
                    size="sm"
                    disabled={page + 1 >= pages || busy}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("tandem.downloadTree.next")}
                  </Button>
                </div>
              )}
              {restorable && (
                <>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    {t("downloadBatchRecovery.review")}
                  </label>
                  {row.existing && (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        disabled={busy}
                        onChange={(e) => setOverwrite(e.target.checked)}
                      />
                      {t("downloadBatchRecovery.overwrite")}
                    </label>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      !sessionId ||
                      !reviewed ||
                      (row.existing && !overwrite)
                    }
                    onClick={() =>
                      void run(async () => {
                        const reservation = batches.reserveRestore(row.entries),
                          native = window.electronAPI!.downloadDirectories!;
                        let targetId: string | undefined;
                        try {
                          const chosen = nativeDownloadValue(
                            await native.choose(),
                          );
                          if (!chosen) return;
                          targetId = chosen.id;
                          if (!live.current) return;
                          const restored =
                            await downloadBatchRecoveryApi.restore(
                              sessionId!,
                              row.id,
                              chosen.id,
                              reviewed,
                              overwrite,
                            );
                          // Successful native restore consumes the freshly selected root. The global queue owns the result even if this view closes.
                          targetId = undefined;
                          await batches.restore(restored, hostId, reservation);
                          if (live.current) {
                            setOpen(false);
                            setDetail(undefined);
                          }
                        } finally {
                          reservation.close();
                          if (targetId)
                            await native.forget(targetId).catch(() => {});
                        }
                      })
                    }
                  >
                    {t("downloadBatchRecovery.restore")}
                  </Button>
                  {!row.unknown && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setDiscard(true)}
                    >
                      {t("downloadBatchRecovery.discard")}
                    </Button>
                  )}
                </>
              )}
              {!!row.unknown && (
                <>
                  <p className="text-sm">
                    {t("downloadBatchRecovery.unknown")}
                  </p>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        const result = await downloadBatchRecoveryApi.check(
                          sessionId!,
                          row.id,
                        );
                        batches.reconciled(row.id, result.completed ?? []);
                        await refresh();
                        await select(row.id);
                      })
                    }
                  >
                    {t("downloadBatchRecovery.check")}
                  </Button>
                </>
              )}
              {discard && restorable && !row.unknown && (
                <div className="rounded border border-border p-3 space-y-2">
                  <p className="text-sm">
                    {t("downloadBatchRecovery.discardHint")}
                  </p>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        await downloadBatchRecoveryApi.discard(
                          sessionId!,
                          row.id,
                        );
                        await refresh();
                        await select(row.id);
                      })
                    }
                  >
                    {t("downloadBatchRecovery.confirmDiscard")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDiscard(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              )}
              {["completed", "cancelled"].includes(row.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !sessionId}
                  onClick={() =>
                    void run(async () => {
                      await downloadBatchRecoveryApi.remove(sessionId!, row.id);
                      if (live.current) setDetail(undefined);
                      await refresh();
                    })
                  }
                >
                  {t("downloadBatchRecovery.remove")}
                </Button>
              )}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
