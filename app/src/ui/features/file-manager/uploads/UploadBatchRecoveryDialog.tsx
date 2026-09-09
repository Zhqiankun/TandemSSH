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
import { uploadBatchRecoveryApi } from "@/api/upload-batch-recovery-api";
import { uploadErrorCode } from "@/api/file-upload-api";
import {
  uploadBatches,
  uploadSourceValue,
  type UploadBatches,
} from "./upload-batches";
import type { UploadBatchRecoverySummary } from "@/types/upload-batch-recovery";
import type { NativeUploadSelection } from "@/types/upload-source";
import type { UploadTreeEntry } from "@/types/upload-tree";
export function UploadBatchRecoveryDialog({
  sessionId,
  hostId,
  batches = uploadBatches,
}: {
  sessionId?: string;
  hostId?: number;
  batches?: UploadBatches;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<UploadBatchRecoverySummary[]>([]),
    [selected, setSelected] = useState<string>(),
    [entries, setEntries] = useState<UploadTreeEntry[]>([]),
    [source, setSource] = useState<NativeUploadSelection>(),
    [reviewed, setReviewed] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [takeover, setTakeover] = useState(false),
    [discard, setDiscard] = useState(false),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  const live = useRef(true),
    sourceRef = useRef<NativeUploadSelection | undefined>(undefined);
  const dropSource = () => {
    const s = sourceRef.current;
    sourceRef.current = undefined;
    if (s) void window.electronAPI?.uploadSources?.forget(s.id).catch(() => {});
    setSource(undefined);
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const s = sourceRef.current;
      if (s)
        void window.electronAPI?.uploadSources?.forget(s.id).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!open || !sessionId) return;
    let current = true;
    setBusy(true);
    void uploadBatchRecoveryApi
      .list(sessionId)
      .then(
        (v) => {
          if (current) setRows(v);
        },
        (e) => {
          if (current) setError(uploadErrorCode(e));
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [open, sessionId, revision]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      if (live.current) setRevision((n) => n + 1);
    } catch (e) {
      if (live.current) setError(uploadErrorCode(e));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const select = async (id: string) => {
    dropSource();
    setSelected(id);
    setEntries([]);
    setReviewed(false);
    setOverwrite(false);
    setDiscard(false);
    setTakeover(false);
    setPage(0);
    if (sessionId) {
      const detail = await uploadBatchRecoveryApi.detail(sessionId, id);
      if (live.current) setEntries(detail.entries);
    }
  };
  if (!window.electronAPI?.uploadSources?.recoveryIdentity) return null;
  const row = rows.find((r) => r.id === selected),
    pages = Math.max(1, Math.ceil(entries.length / 50));
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("uploadBatchRecovery.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) {
              dropSource();
              setSelected(undefined);
              setEntries([]);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("uploadBatchRecovery.title")}</DialogTitle>
            <DialogDescription>
              {t("uploadBatchRecovery.hint")}
            </DialogDescription>
          </DialogHeader>
          {!sessionId && <p>{t("uploadBatchRecovery.connect")}</p>}
          {busy && <p role="status">{t("uploadBatchRecovery.busy")}</p>}
          {error && (
            <p role="alert" className="text-amber-500">
              {t("uploadBatchRecovery.errors." + error, {
                defaultValue: t("tandem.upload.errors." + error, {
                  defaultValue: t("uploadRecovery.errors." + error, {
                    defaultValue: t("uploadBatchRecovery.failed"),
                  }),
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
          {!rows.length && !busy && <p>{t("uploadBatchRecovery.empty")}</p>}
          <div className="space-y-2">
            {rows.map((r) => (
              <button
                type="button"
                key={r.id}
                disabled={busy}
                aria-pressed={selected === r.id}
                className="block w-full rounded border border-border p-3 text-left text-sm disabled:opacity-60"
                onClick={() => void run(() => select(r.id))}
              >
                <strong>{r.name}</strong>
                <span className="float-right">
                  {t("uploadBatchRecovery.states." + r.state)}
                </span>
                <p className="break-all">
                  {r.hostIdentity} · {r.path}
                </p>
                <p>
                  {t("uploadBatchRecovery.progress", {
                    completed: r.completed,
                    total: r.entries,
                    paused: r.paused,
                    unknown: r.unknown,
                  })}
                </p>
              </button>
            ))}
          </div>
          {row && (
            <section className="border-t border-border pt-3 space-y-3">
              <h3 className="font-medium">{t("uploadBatchRecovery.plan")}</h3>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left">
                        {t("uploadBatchRecovery.target")}
                      </th>
                      <th className="text-left">
                        {t("uploadBatchRecovery.result")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(page * 50, (page + 1) * 50).map((e) => (
                      <tr key={e.id}>
                        <td className="p-1 break-all">{e.path}</td>
                        <td className="p-1">
                          {e.fileResult
                            ? t("uploadBatchRecovery.done")
                            : e.result
                              ? t(
                                  "uploadBatchRecovery.entryStates." +
                                    e.result.state,
                                )
                              : t(
                                  "uploadBatchRecovery.actions." +
                                    (e.action ?? "create"),
                                )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex gap-2 items-center">
                  <Button
                    size="sm"
                    disabled={!page || busy}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    {t("tandem.uploadTree.previous")}
                  </Button>
                  <span>
                    {page + 1} / {pages}
                  </span>
                  <Button
                    size="sm"
                    disabled={page + 1 >= pages || busy}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    {t("tandem.uploadTree.next")}
                  </Button>
                </div>
              )}
              {["available", "interrupted"].includes(row.state) && (
                <>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        const native = window.electronAPI!.uploadSources!;
                        const chosen = uploadSourceValue(
                          await native.chooseDirectory(),
                        );
                        if (!chosen) return;
                        if (!live.current) {
                          await native.forget(chosen.id);
                          return;
                        }
                        dropSource();
                        sourceRef.current = chosen;
                        setSource(chosen);
                      })
                    }
                  >
                    {t("uploadBatchRecovery.choose")}
                  </Button>
                  <label className="block text-sm">
                    {t("uploadBatchRecovery.chooseFiles")}
                    <input
                      type="file"
                      multiple
                      disabled={busy || !sessionId}
                      aria-label={t("uploadBatchRecovery.chooseFiles")}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (!files.length) return;
                        void run(async () => {
                          const native = window.electronAPI!.uploadSources!,
                            chosen = uploadSourceValue(
                              await native.fromFiles(files),
                            );
                          if (!live.current) {
                            await native.forget(chosen.id);
                            return;
                          }
                          dropSource();
                          sourceRef.current = chosen;
                          setSource(chosen);
                        });
                      }}
                    />
                  </label>
                  {source && (
                    <p className="break-all">
                      {source.entries
                        .filter((e) => !e.parentId)
                        .map((e) => e.path)
                        .join(", ")}
                    </p>
                  )}
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy || !entries.length}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    {t("uploadBatchRecovery.reviewed")}
                  </label>
                  {row.existing && (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        disabled={busy}
                        onChange={(e) => setOverwrite(e.target.checked)}
                      />
                      {t("uploadBatchRecovery.overwrite")}
                    </label>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      !sessionId ||
                      !source ||
                      !reviewed ||
                      (row.existing && !overwrite)
                    }
                    onClick={() =>
                      void run(async () => {
                        const reservation = batches.reserveRestore(
                          source!.entries.length,
                        );
                        try {
                          const result = await uploadBatchRecoveryApi.restore(
                            sessionId!,
                            row.id,
                            source!.id,
                            reviewed,
                            overwrite,
                          );
                          sourceRef.current = undefined;
                          await batches.restore(result, hostId, reservation);
                          if (live.current) {
                            setSource(undefined);
                            setOpen(false);
                          }
                        } finally {
                          reservation.close();
                        }
                      })
                    }
                  >
                    {t("uploadBatchRecovery.restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDiscard(true)}
                  >
                    {t("uploadBatchRecovery.discard")}
                  </Button>
                </>
              )}
              {row.unknown > 0 && (
                <>
                  <p>{t("uploadBatchRecovery.unknown")}</p>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={takeover}
                      onChange={(e) => setTakeover(e.target.checked)}
                      disabled={busy}
                    />
                    {t("uploadBatchRecovery.takeover")}
                  </label>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        const checked = await uploadBatchRecoveryApi.check(
                          sessionId!,
                          row.id,
                          takeover,
                        );
                        batches.reconciled(row.id, checked.tree);
                        setEntries(checked.tree.entries);
                      })
                    }
                  >
                    {t("uploadBatchRecovery.check")}
                  </Button>
                </>
              )}
              {discard && (
                <div className="rounded border border-amber-700 p-3 space-y-2">
                  <p>{t("uploadBatchRecovery.discardHint")}</p>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={takeover}
                      onChange={(e) => setTakeover(e.target.checked)}
                      disabled={busy}
                    />
                    {t("uploadBatchRecovery.takeover")}
                  </label>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        await uploadBatchRecoveryApi.discard(
                          sessionId!,
                          row.id,
                          takeover,
                        );
                        setDiscard(false);
                        dropSource();
                      })
                    }
                  >
                    {t("uploadBatchRecovery.confirmDiscard")}
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
                      await uploadBatchRecoveryApi.remove(sessionId!, row.id);
                      setSelected(undefined);
                      setEntries([]);
                    })
                  }
                >
                  {t("uploadBatchRecovery.remove")}
                </Button>
              )}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
