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
import { uploadTreeApi } from "@/api/upload-tree-api";
import { uploadErrorCode } from "@/api/file-upload-api";
import type { NativeUploadSelection } from "@/types/upload-source";
import type { UploadTreePreview, UploadTreeAction } from "@/types/upload-tree";
import { uploadBatches, uploadSourceValue as value } from "./upload-batches";
import type { LocalBrowserSelection } from "@/types/local-file-browser";
export interface DirectoryUploadRequest {
  localSelection?: LocalBrowserSelection;
  sessionId: string;
  path: string;
  hostLabel: string;
  hostId?: number;
  files?: File[];
}
interface Owned {
  source?: NativeUploadSelection;
  target?: UploadTreePreview;
  handed: boolean;
  live: boolean;
}
export function UploadTreeDialog({
  request,
  onClose,
}: {
  request: DirectoryUploadRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<NativeUploadSelection>();
  const [target, setTarget] = useState<UploadTreePreview>();
  const [names, setNames] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, UploadTreeAction | "">>(
    {},
  );
  const [busy, setBusy] = useState("scanning"),
    [error, setError] = useState<string>(),
    [dirty, setDirty] = useState(false),
    [page, setPage] = useState(0),
    [takeover, setTakeover] = useState(false);
  const refs = useRef<Owned>({ handed: false, live: true });
  const native = window.electronAPI?.uploadSources;
  const message = (code: string) =>
    code.startsWith("LOCAL_")
      ? t("tandem.localBrowser.errors." + code, {
          defaultValue: t("tandem.localBrowser.failed"),
        })
      : t("tandem.upload.errors." + code, {
          defaultValue: t("tandem.collaboration.errors." + code, {
            defaultValue: t("tandem.upload.failed"),
          }),
        });
  const release = async (owned: Owned) => {
    if (owned.handed) return;
    if (owned.target)
      await uploadTreeApi
        .forget(request.sessionId, owned.target.id)
        .catch(() => {});
    if (owned.source) await native?.forget(owned.source.id).catch(() => {});
  };
  const preview = async (owned: Owned, renames: Record<string, string>) => {
    if (!owned.source) throw Error("UPLOAD_SOURCE_UNAVAILABLE");
    if (owned.target) {
      await uploadTreeApi.forget(request.sessionId, owned.target.id);
      owned.target = undefined;
      setTarget(undefined);
    }
    const result = await uploadTreeApi.preview({
      sessionId: request.sessionId,
      path: request.path,
      entries: owned.source.entries
        .filter(
          (e) => !e.error && (e.kind === "file" || e.kind === "directory"),
        )
        .map((e) => ({
          id: e.id,
          parentId: e.parentId,
          name: renames[e.id] ?? e.name,
          kind: e.kind as "file" | "directory",
          size: e.size,
          lastModified: e.lastModified,
        })),
    });
    owned.target = result;
    if (!owned.live) {
      await release(owned);
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
  useEffect(() => {
    const owned: Owned = { handed: false, live: true };
    refs.current = owned;
    void (async () => {
      if (!native) throw Error("UPLOAD_DESKTOP_REQUIRED");
      const selected = value(
        await (request.localSelection
          ? window.electronAPI!.localBrowser!.upload(
              request.localSelection.rootId,
              request.localSelection.entries,
            )
          : request.files
            ? native.fromFiles(request.files)
            : native.chooseDirectory()),
      );
      if (!selected) {
        if (owned.live) onClose();
        return;
      }
      owned.source = selected;
      if (!owned.live) {
        await release(owned);
        return;
      }
      setSource(selected);
      setNames(Object.fromEntries(selected.entries.map((e) => [e.id, e.name])));
      setBusy("checking");
      await preview(owned, {});
    })()
      .catch((e) => {
        if (owned.live) setError(uploadErrorCode(e));
      })
      .finally(() => {
        if (owned.live) setBusy("");
      });
    const timer = setInterval(() => {
      if (owned.target && !owned.handed)
        void uploadTreeApi
          .touch(request.sessionId, owned.target.id)
          .catch((e) => {
            if (owned.live) setError(uploadErrorCode(e));
          });
    }, 60000);
    return () => {
      owned.live = false;
      clearInterval(timer);
      void release(owned);
    };
    // One mounted dialog owns its source and immutable remote preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = source?.entries ?? [];
  const targets = useMemo(
    () => new Map(target?.entries.map((e) => [e.id, e]) ?? []),
    [target],
  );
  const selected = (id: string): UploadTreeAction | "" => {
    const e = targets.get(id);
    if (e?.parentId && selected(e.parentId) === "skip") return "skip";
    return choices[id] ?? "";
  };
  const ready =
    !!target &&
    !busy &&
    !dirty &&
    target.entries.every((e) => !!selected(e.id));
  const recheck = async () => {
    setBusy("checking");
    setError(undefined);
    setDirty(true);
    try {
      await preview(refs.current, names);
    } catch (e) {
      if (refs.current.live) setError(uploadErrorCode(e));
    } finally {
      if (refs.current.live) setBusy("");
    }
  };
  const start = async () => {
    if (!source || !target || !ready) return;
    const owned = refs.current;
    setBusy("starting");
    setError(undefined);
    owned.handed = true;
    try {
      await uploadBatches.start({
        source,
        target,
        hostLabel: request.hostLabel,
        hostId: request.hostId,
        takeover,
        decisions: target.entries.map((e) => ({
          id: e.id,
          action: selected(e.id) as UploadTreeAction,
        })),
      });
      if (owned.live) onClose();
    } catch (e) {
      owned.handed = false;
      if (owned.live) {
        setError(uploadErrorCode(e));
        setBusy("");
        setDirty(true);
      } else await release(owned);
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
          <DialogTitle>{t("tandem.uploadTree.title")}</DialogTitle>
          <DialogDescription>
            {request.hostLabel} · {t("tandem.uploadTree.description")}
          </DialogDescription>
        </DialogHeader>
        {source && (
          <p className="text-sm">
            {t("tandem.uploadTree.summary", {
              files: source.entries.filter((e) => e.kind === "file").length,
              directories: source.entries.filter((e) => e.kind === "directory")
                .length,
              bytes: source.bytes,
              skipped: source.excluded,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          {source && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void recheck()}
            >
              {t("tandem.uploadTree.recheck")}
            </Button>
          )}
          {target && (
            <p className="text-xs break-all select-text">{target.path}</p>
          )}
        </div>
        {busy && (
          <p role="status" className="text-sm">
            {t("tandem.uploadTree." + busy)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-amber-500">
            {message(error)}
          </p>
        )}
        {dirty && (
          <p role="status" className="text-sm text-amber-500">
            {t("tandem.uploadTree.dirty")}
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
              {t("tandem.uploadTree.skipConflicts")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || dirty}
              onClick={() => apply("merge")}
            >
              {t("tandem.uploadTree.mergeDirectories")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || dirty}
              onClick={() => apply("overwrite")}
            >
              {t("tandem.uploadTree.overwriteFiles")}
            </Button>
          </div>
        )}
        {!!rows.length && (
          <div className="max-h-[45vh] overflow-auto border rounded border-border">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="p-2">{t("tandem.uploadTree.source")}</th>
                  <th className="p-2">{t("tandem.uploadTree.name")}</th>
                  <th className="p-2">{t("tandem.uploadTree.action")}</th>
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
                              ? t("tandem.uploadTree.directory")
                              : entry.size + " B"}
                          </p>
                          {(entry.error || destination?.error) && (
                            <p className="text-amber-500">
                              {message(entry.error ?? destination!.error!)}
                            </p>
                          )}
                          {destination?.existing && (
                            <p>
                              {t("tandem.uploadTree.existing", {
                                bytes: destination.existing.size,
                              })}
                            </p>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full min-w-36 bg-background border border-border rounded p-1"
                            aria-label={t("tandem.uploadTree.rename", {
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
                            t("tandem.uploadTree.skipped")
                          ) : destination ? (
                            <select
                              className="bg-background border border-border rounded p-1"
                              aria-label={t("tandem.uploadTree.choice", {
                                name: entry.relativePath,
                              })}
                              value={action}
                              disabled={!!busy || dirty || inherited}
                              onChange={(e) =>
                                setChoices((previous) => ({
                                  ...previous,
                                  [entry.id]: e.target
                                    .value as UploadTreeAction,
                                }))
                              }
                            >
                              <option value="">
                                {t("tandem.uploadTree.required")}
                              </option>
                              {destination.status === "new" && (
                                <option value="create">
                                  {t("tandem.uploadTree.create")}
                                </option>
                              )}
                              {destination.status === "directory" && (
                                <option value="merge">
                                  {t("tandem.uploadTree.merge")}
                                </option>
                              )}
                              {destination.status === "conflict" && (
                                <option value="overwrite">
                                  {t("tandem.uploadTree.overwrite")}
                                </option>
                              )}
                              <option value="skip">
                                {t("tandem.uploadTree.skip")}
                              </option>
                            </select>
                          ) : (
                            t("tandem.uploadTree.awaitingTarget")
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
              {t("tandem.uploadTree.previous")}
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
              {t("tandem.uploadTree.next")}
            </Button>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={takeover}
            disabled={!!busy}
            onChange={(e) => setTakeover(e.target.checked)}
          />
          {t("tandem.uploadTree.takeover")}
        </label>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy === "starting"}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={!ready} onClick={() => void start()}>
            {t("tandem.uploadTree.start")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
