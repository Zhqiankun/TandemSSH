import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { downloadTreeApi } from "@/api/download-tree-api";
import {
  downloadErrorCode,
  nativeDownloadValue as value,
} from "@/api/file-download-api";
import type {
  DownloadTreePreview,
  LocalDownloadTreePreview,
  LocalDownloadTreeAction,
} from "@/types/download-tree";
import { downloadBatches } from "./download-batches";
import type { LocalBrowserTarget } from "@/types/local-file-browser";
export interface DirectoryDownloadRequest {
  localTarget?: LocalBrowserTarget;
  sessionId: string;
  paths: string[];
  hostLabel: string;
  hostId?: number;
}
export function DownloadTreeDialog({
  request,
  onClose,
}: {
  request: DirectoryDownloadRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<DownloadTreePreview>();
  const [target, setTarget] = useState<LocalDownloadTreePreview>();
  const [names, setNames] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<
    Record<string, LocalDownloadTreeAction | "">
  >({});
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState("scanning"),
    [error, setError] = useState<string>(),
    [page, setPage] = useState(0);
  const refs = useRef<{
    source?: DownloadTreePreview;
    target?: LocalDownloadTreePreview;
    handed: boolean;
    live: boolean;
  }>({ handed: false, live: true });
  const native = window.electronAPI?.downloadDirectories;
  const message = (code: string) =>
    code.startsWith("LOCAL_")
      ? t("tandem.localBrowser.errors." + code, {
          defaultValue: t("tandem.localBrowser.failed"),
        })
      : t("tandem.download.errors." + code, {
          defaultValue: t("tandem.download.failed"),
        });
  const release = async () => {
    const owned = refs.current;
    if (owned.handed) return;
    const target = owned.target,
      source = owned.source;
    if (target && native) {
      await native.cancel(target.id).catch(() => {});
      await native.forget(target.id).catch(() => {});
    }
    if (source)
      await downloadTreeApi
        .forget(request.sessionId, source.id)
        .catch(() => {});
  };
  useEffect(() => {
    const stop = new AbortController(),
      owned = refs.current;
    owned.live = true;
    void downloadTreeApi
      .scan({ sessionId: request.sessionId, paths: request.paths }, stop.signal)
      .then(async (result) => {
        if (stop.signal.aborted) {
          await downloadTreeApi
            .forget(request.sessionId, result.id)
            .catch(() => {});
          return;
        }
        owned.source = result;
        if (!owned.live) {
          await downloadTreeApi
            .forget(request.sessionId, result.id)
            .catch(() => {});
          return;
        }
        setSource(result);
        setNames(Object.fromEntries(result.entries.map((e) => [e.id, e.name])));
        if (request.localTarget) {
          setBusy("checking");
          const root = value(
            await window.electronAPI!.localBrowser!.download(
              request.localTarget.rootId,
              request.localTarget.relativePath,
            ),
          );
          owned.target = root;
          if (!owned.live) {
            await release();
            return;
          }
          await preview(root, result, {});
        }
        if (owned.live) setBusy("");
      })
      .catch((e) => {
        if (owned.live && !stop.signal.aborted) {
          setError(downloadErrorCode(e));
          setBusy("");
        }
      });
    return () => {
      owned.live = false;
      stop.abort();
      void release();
    };
    // Each mounted dialog owns one immutable request and its previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = source?.entries ?? [];
  const targets = useMemo(
    () => new Map(target?.entries.map((e) => [e.id, e]) ?? []),
    [target],
  );
  const selected = (id: string): LocalDownloadTreeAction | "" => {
    const entry = targets.get(id);
    if (entry?.parentId && selected(entry.parentId) === "skip") return "skip";
    return choices[id] ?? "";
  };
  const ready =
    !!target &&
    !dirty &&
    !busy &&
    target.entries.every((e) => !!selected(e.id));
  const preview = async (
    root: LocalDownloadTreePreview,
    sourceSnapshot = source,
    renames = names,
  ) => {
    if (!sourceSnapshot || !native) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    const result = value(
      await native.preview(
        root.id,
        sourceSnapshot.entries
          .filter(
            (e) => !e.error && (e.kind === "file" || e.kind === "directory"),
          )
          .map((e) => ({
            id: e.id,
            parentId: e.parentId,
            name: renames[e.id] ?? e.name,
            kind: e.kind as "file" | "directory",
            size: e.kind === "directory" ? 0 : e.size,
          })),
      ),
    );
    refs.current.target = result;
    if (!refs.current.live) {
      await release();
      return;
    }
    setTarget(result);
    setChoices(
      Object.fromEntries(
        result.entries.map((e) => [e.id, e.status === "new" ? "create" : ""]),
      ),
    );
    setDirty(false);
  };
  const choose = async () => {
    if (!native || !source) return;
    setBusy("checking");
    setError(undefined);
    try {
      if (refs.current.target) {
        value(await native.cancel(refs.current.target.id));
        value(await native.forget(refs.current.target.id));
        refs.current.target = undefined;
        setTarget(undefined);
      }
      const root = value(await native.choose());
      if (!root) return;
      refs.current.target = root;
      if (!refs.current.live) {
        await release();
        return;
      }
      await preview(root);
    } catch (e) {
      if (refs.current.live) setError(downloadErrorCode(e));
      else await release();
    } finally {
      if (refs.current.live) setBusy("");
    }
  };
  const recheck = async () => {
    if (!target) return;
    setBusy("checking");
    setError(undefined);
    try {
      await preview(target);
    } catch (e) {
      setError(downloadErrorCode(e));
    } finally {
      setBusy("");
    }
  };
  const start = async () => {
    if (!source || !target || !ready) return;
    setBusy("starting");
    setError(undefined);
    refs.current.handed = true;
    try {
      await downloadBatches.start({
        source,
        target,
        hostLabel: request.hostLabel,
        hostId: request.hostId,
        decisions: target.entries.map((e) => ({
          id: e.id,
          action: selected(e.id) as LocalDownloadTreeAction,
        })),
      });
      onClose();
    } catch (e) {
      refs.current.handed = false;
      if (refs.current.live) {
        setError(downloadErrorCode(e));
        setBusy("");
      } else await release();
    }
  };
  const apply = (mode: "skip" | "merge" | "overwrite") =>
    setChoices((previous) => {
      const next = { ...previous };
      for (const e of target?.entries ?? [])
        if (mode === "skip" && e.status !== "new") next[e.id] = "skip";
        else if (mode === "merge" && e.status === "directory")
          next[e.id] = "merge";
        else if (mode === "overwrite" && e.status === "conflict")
          next[e.id] = "overwrite";
      return next;
    });
  const totalPages = Math.max(1, Math.ceil(rows.length / 100)),
    currentPage = Math.min(page, totalPages - 1);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy !== "starting") onClose();
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tandem.downloadTree.title")}</DialogTitle>
          <DialogDescription>
            {request.hostLabel} · {t("tandem.downloadTree.description")}
          </DialogDescription>
        </DialogHeader>
        {source && (
          <p className="text-sm">
            {t("tandem.downloadTree.summary", {
              files: source.files,
              directories: source.directories,
              bytes: source.totalBytes,
              skipped: source.skipped,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            disabled={
              !!busy ||
              !source ||
              !native ||
              source.files + source.directories === 0
            }
            onClick={() => void choose()}
          >
            {t("tandem.downloadTree.choose")}
          </Button>
          {target && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void recheck()}
            >
              {t("tandem.downloadTree.recheck")}
            </Button>
          )}
          {target && (
            <p className="text-xs break-all select-text">{target.path}</p>
          )}
        </div>
        {busy && (
          <p role="status" className="text-sm">
            {t("tandem.downloadTree." + busy)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-amber-500">
            {message(error)}
          </p>
        )}
        {dirty && (
          <p role="status" className="text-sm text-amber-500">
            {t("tandem.downloadTree.dirty")}
          </p>
        )}
        {target && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || dirty}
              onClick={() => apply("skip")}
            >
              {t("tandem.downloadTree.skipConflicts")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || dirty}
              onClick={() => apply("merge")}
            >
              {t("tandem.downloadTree.mergeDirectories")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || dirty}
              onClick={() => apply("overwrite")}
            >
              {t("tandem.downloadTree.overwriteFiles")}
            </Button>
          </div>
        )}
        {!!rows.length && (
          <div className="max-h-[45vh] overflow-auto border rounded border-border">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="p-2">{t("tandem.downloadTree.source")}</th>
                  <th className="p-2">{t("tandem.downloadTree.name")}</th>
                  <th className="p-2">{t("tandem.downloadTree.action")}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(currentPage * 100, (currentPage + 1) * 100)
                  .map((entry) => {
                    const destination = targets.get(entry.id),
                      action = destination ? selected(entry.id) : "",
                      inherited =
                        !!destination?.parentId &&
                        selected(destination.parentId) === "skip";
                    return (
                      <tr
                        key={entry.id}
                        className="border-t border-border align-top"
                      >
                        <td className="p-2 break-all max-w-80">
                          <span className="select-text">{entry.path}</span>
                          <p className="text-muted-foreground">
                            {entry.kind === "directory"
                              ? t("tandem.downloadTree.directory")
                              : entry.size + " B"}
                          </p>
                          {(entry.error || destination?.error) && (
                            <p className="text-amber-500">
                              {message(entry.error ?? destination!.error!)}
                            </p>
                          )}
                          {destination?.existing && (
                            <p>
                              {t("tandem.downloadTree.existing", {
                                bytes: destination.existing.size,
                              })}
                            </p>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full min-w-36 bg-background border border-border rounded p-1"
                            aria-label={t("tandem.downloadTree.rename", {
                              name: entry.relativePath,
                            })}
                            value={names[entry.id] ?? entry.name}
                            disabled={!!busy || !!entry.error}
                            onChange={(e) => {
                              setNames((previous) => ({
                                ...previous,
                                [entry.id]: e.target.value,
                              }));
                              setDirty(true);
                            }}
                          />
                          {destination?.path && (
                            <p className="max-w-80 break-all text-muted-foreground">
                              {destination.relativePath}
                            </p>
                          )}
                        </td>
                        <td className="p-2">
                          {entry.error ? (
                            t("tandem.downloadTree.skipped")
                          ) : destination ? (
                            <select
                              className="bg-background border border-border rounded p-1"
                              aria-label={t("tandem.downloadTree.choice", {
                                name: entry.relativePath,
                              })}
                              value={action}
                              disabled={!!busy || dirty || inherited}
                              onChange={(e) =>
                                setChoices((previous) => ({
                                  ...previous,
                                  [entry.id]: e.target
                                    .value as LocalDownloadTreeAction,
                                }))
                              }
                            >
                              <option value="">
                                {t("tandem.downloadTree.required")}
                              </option>
                              {destination.status === "new" && (
                                <option value="create">
                                  {t("tandem.downloadTree.create")}
                                </option>
                              )}
                              {destination.status === "directory" && (
                                <option value="merge">
                                  {t("tandem.downloadTree.merge")}
                                </option>
                              )}
                              {destination.status === "conflict" && (
                                <option value="overwrite">
                                  {t("tandem.downloadTree.overwrite")}
                                </option>
                              )}
                              <option value="skip">
                                {t("tandem.downloadTree.skip")}
                              </option>
                            </select>
                          ) : (
                            t("tandem.downloadTree.awaitingTarget")
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("tandem.downloadTree.previous")}
            </Button>
            <span>
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage + 1 >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("tandem.downloadTree.next")}
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy === "starting"}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={!ready} onClick={() => void start()}>
            {t("tandem.downloadTree.start")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
