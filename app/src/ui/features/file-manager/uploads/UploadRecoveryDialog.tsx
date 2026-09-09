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
import { uploadRecoveryApi } from "@/api/upload-recovery-api";
import { uploadErrorCode } from "@/api/file-upload-api";
import { uploadManifest } from "./source";
import type { UploadQueue } from "./queue";
import type { UploadRecoverySummary } from "@/types/upload-recovery";
export function UploadRecoveryDialog({
  queue,
  sessionId,
  hostId,
}: {
  queue: UploadQueue;
  sessionId?: string;
  hostId?: number;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<UploadRecoverySummary[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [files, setFiles] = useState<Record<string, File>>({}),
    [overwrite, setOverwrite] = useState<Record<string, boolean>>({}),
    [takeover, setTakeover] = useState(false),
    [discard, setDiscard] = useState<string>(),
    [checked, setChecked] = useState(0);
  const life = useRef({ active: true, stop: new AbortController() });
  useEffect(() => {
    const state = life.current;
    state.active = true;
    if (state.stop.signal.aborted) state.stop = new AbortController();
    return () => {
      state.active = false;
      state.stop.abort();
    };
  }, []);
  useEffect(() => {
    if (!open || !sessionId) return;
    let live = true;
    setBusy(true);
    setError(undefined);
    void uploadRecoveryApi
      .list(sessionId)
      .then((value) => {
        if (live) setRows(value);
      })
      .catch((e) => {
        if (live) setError(uploadErrorCode(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [open, sessionId, revision]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setChecked(0);
    try {
      await work();
      if (life.current.active) setRevision((n) => n + 1);
    } catch (e) {
      if (life.current.active) setError(uploadErrorCode(e));
    } finally {
      if (life.current.active) setBusy(false);
    }
  };
  if (!window.electronAPI?.uploadSources?.recoveryIdentity) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("uploadRecovery.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v);
            if (!v) setFiles({});
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("uploadRecovery.title")}</DialogTitle>
            <DialogDescription>{t("uploadRecovery.hint")}</DialogDescription>
          </DialogHeader>
          {!sessionId && <p>{t("uploadRecovery.connectFirst")}</p>}
          {busy && (
            <p role="status">{t("uploadRecovery.busy", { bytes: checked })}</p>
          )}
          {error && (
            <p role="alert" className="text-amber-500">
              {t("uploadRecovery.errors." + error, {
                defaultValue: t("tandem.upload.errors." + error, {
                  defaultValue: t("tandem.collaboration.errors." + error, {
                    defaultValue: t("uploadRecovery.failed"),
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
          {!busy && !rows.length && !error && (
            <p>{t("uploadRecovery.empty")}</p>
          )}
          {rows.map((row) => (
            <article
              key={row.id}
              className="border border-border rounded p-3 space-y-2 text-sm"
            >
              <div className="flex justify-between gap-3">
                <strong className="break-all">{row.name}</strong>
                <span>{t("uploadRecovery.states." + row.state)}</span>
              </div>
              <p className="break-all">
                {row.hostIdentity} · {row.path}
              </p>
              <p>
                {t("uploadRecovery.progress", {
                  bytes: row.receivedBytes,
                  total: row.size,
                })}
              </p>
              {["available", "interrupted"].includes(row.state) && (
                <>
                  <label className="block">
                    {t("uploadRecovery.choose")}
                    <input
                      type="file"
                      className="block max-w-full"
                      aria-label={t("uploadRecovery.choose") + " " + row.name}
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          setFiles((old) => ({ ...old, [row.id]: file }));
                      }}
                    />
                  </label>
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
                      {t("uploadRecovery.overwrite")}
                    </label>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      !sessionId ||
                      !files[row.id] ||
                      (row.existing && !overwrite[row.id])
                    }
                    onClick={() =>
                      void run(async () => {
                        const reserved = queue.reserveRecovery();
                        try {
                          const detail = await uploadRecoveryApi.detail(
                              sessionId!,
                              row.id,
                            ),
                            file = files[row.id];
                          const manifest = await uploadManifest(
                            file,
                            life.current.stop.signal,
                            (n) => {
                              if (life.current.active) setChecked(n);
                            },
                            detail.manifest,
                          );
                          const result = await uploadRecoveryApi.restore(
                            sessionId!,
                            row.id,
                            manifest,
                            !!overwrite[row.id],
                          );
                          reserved.accept(result, file, hostId);
                          if (life.current.active) {
                            setOpen(false);
                            setFiles({});
                          }
                        } finally {
                          reserved.close();
                        }
                      })
                    }
                  >
                    {t("uploadRecovery.restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDiscard(row.id)}
                  >
                    {t("uploadRecovery.discard")}
                  </Button>
                  {discard === row.id && (
                    <div>
                      <p>{t("uploadRecovery.discardHint")}</p>
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          checked={takeover}
                          onChange={(e) => setTakeover(e.target.checked)}
                        />
                        {t("uploadRecovery.takeover")}
                      </label>
                      <Button
                        size="sm"
                        disabled={busy || !sessionId}
                        onClick={() =>
                          void run(async () => {
                            await uploadRecoveryApi.discard(
                              sessionId!,
                              row.id,
                              takeover,
                            );
                            setDiscard(undefined);
                          })
                        }
                      >
                        {t("uploadRecovery.confirmDiscard")}
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
              {["committing", "unknown"].includes(row.state) && (
                <>
                  <p>{t("uploadRecovery.unknown")}</p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={takeover}
                      onChange={(e) => setTakeover(e.target.checked)}
                    />
                    {t("uploadRecovery.takeover")}
                  </label>
                  <Button
                    size="sm"
                    disabled={busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        const result = await uploadRecoveryApi.check(
                          sessionId!,
                          row.id,
                          takeover,
                        );
                        queue.reconcileRecovery(row.id, result.view);
                      })
                    }
                  >
                    {t("uploadRecovery.check")}
                  </Button>
                </>
              )}
              {["completed", "cancelled"].includes(row.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !sessionId}
                  onClick={() =>
                    void run(async () => {
                      await uploadRecoveryApi.remove(sessionId!, row.id);
                    })
                  }
                >
                  {t("uploadRecovery.remove")}
                </Button>
              )}
            </article>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
