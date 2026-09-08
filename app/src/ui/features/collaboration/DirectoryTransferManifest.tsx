import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { directoryTransferApi } from "@/api/directory-transfer-api";
import { localFileError } from "@/api/local-file-grants-api";
import type {
  DirectoryChoice,
  DirectoryEntryView,
  DirectoryPreviewPage,
} from "@/types/directory-transfer";
export interface DirectoryReviewState {
  ready: boolean;
  revision: string;
  choices: Array<{ id: string; action: DirectoryChoice }>;
  renames: Array<{ relativePath: string; name: string }>;
  hasRenames: boolean;
}
export function DirectoryTransferManifest({
  taskId,
  previewId,
  choices: fixed,
  editable = false,
  refreshKey,
  onReview,
}: {
  taskId: string;
  previewId: string;
  choices?: Array<{ id: string; action: DirectoryChoice }>;
  editable?: boolean;
  refreshKey?: string;
  onReview?: (state: DirectoryReviewState) => void;
}) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0),
    [page, setPage] = useState<DirectoryPreviewPage>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [entries, setEntries] = useState<Record<string, DirectoryEntryView>>(
      {},
    ),
    [values, setValues] = useState<Record<string, DirectoryChoice>>({}),
    [reviewed, setReviewed] = useState<Set<number>>(new Set()),
    [renames, setRenames] = useState<Record<string, string>>({});
  const notify = useRef(onReview);
  notify.current = onReview;
  const fixedValues = useMemo(
    () => Object.fromEntries((fixed ?? []).map((e) => [e.id, e.action])),
    [fixed],
  );
  useEffect(() => {
    const stop = new AbortController();
    let live = true;
    setLoading(true);
    setError(undefined);
    void directoryTransferApi
      .page(taskId, previewId, offset, stop.signal)
      .then((p) => {
        if (!live) return;
        setPage(p);
        setEntries((old) => ({
          ...old,
          ...Object.fromEntries(p.items.map((e) => [e.id, e])),
        }));
        setValues((old) => ({
          ...Object.fromEntries(
            p.items.map((e) => [
              e.id,
              e.action ??
                (e.status === "new"
                  ? "create"
                  : e.status === "directory"
                    ? "merge"
                    : "skip"),
            ]),
          ),
          ...old,
        }));
      })
      .catch((e) => {
        if (live) setError(localFileError(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      stop.abort();
    };
  }, [taskId, previewId, offset, refreshKey]);
  useEffect(() => {
    const base = new Map(
      (page?.renames ?? []).map((r) => [r.relativePath, r.name]),
    );
    for (const [relativePath, name] of Object.entries(renames))
      base.set(relativePath, name);
    notify.current?.({
      ready:
        !!page &&
        !loading &&
        !error &&
        Object.keys(entries).length === page.entries &&
        reviewed.size === Math.max(1, Math.ceil(page.entries / 100)),
      revision: page?.revision ?? "",
      choices: Object.entries(fixed ? fixedValues : values).map(
        ([id, action]) => ({ id, action }),
      ),
      renames: [...base].map(([relativePath, name]) => ({
        relativePath,
        name,
      })),
      hasRenames: Object.keys(renames).length > 0,
    });
  }, [
    page,
    loading,
    error,
    entries,
    reviewed,
    values,
    renames,
    fixed,
    fixedValues,
  ]);
  const unreview = () =>
    setReviewed((old) => {
      const copy = new Set(old);
      copy.delete(offset);
      return copy;
    });
  return (
    <section
      className="space-y-3"
      aria-label={t("tandem.directoryTask.manifest")}
    >
      {error && (
        <p role="alert" className="text-amber-500">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.directoryTask.failed"),
          })}
        </p>
      )}
      {loading && <p role="status">{t("tandem.directoryTask.loading")}</p>}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("tandem.directoryTask.summary", {
              entries: page.entries,
              files: page.files,
              directories: page.directories,
              excluded: page.excluded,
              totalBytes: page.totalBytes,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("tandem.directoryTask.budget", {
              count: page.entries - page.excluded + 2,
            })}
          </p>
          <div className="space-y-2" aria-busy={loading}>
            {page.items.map((e) => {
              const choice = fixed ? fixedValues[e.id] : values[e.id],
                options: DirectoryChoice[] =
                  e.status === "blocked" || e.kind === "excluded"
                    ? ["skip"]
                    : e.status === "new"
                      ? ["create", "skip"]
                      : e.status === "directory"
                        ? ["merge", "skip"]
                        : page.overwrite
                          ? ["overwrite", "skip"]
                          : ["skip"];
              return (
                <article
                  key={e.id}
                  className="min-w-0 space-y-1 rounded border border-border p-2 text-xs"
                >
                  <strong className="break-all select-text">
                    {e.relativePath}
                  </strong>
                  <p className="break-all select-text text-muted-foreground">
                    {e.path}
                  </p>
                  <p>
                    {t("tandem.directoryTask.kinds." + e.kind)} · {e.size} B ·{" "}
                    {t("tandem.directoryTask.statuses." + e.status)}
                  </p>
                  {e.error && (
                    <p className="text-amber-500">
                      {t("tandem.collaboration.errors." + e.error, {
                        defaultValue: t("tandem.directoryTask.blocked"),
                      })}
                    </p>
                  )}
                  {editable && page.state === "preview" ? (
                    <>
                      <label className="flex items-center justify-between gap-2">
                        {t("tandem.directoryTask.action")}
                        <select
                          aria-label={t("tandem.directoryTask.actionFor", {
                            name: e.relativePath,
                          })}
                          value={choice ?? "skip"}
                          disabled={loading}
                          onChange={(event) => {
                            setValues((old) => ({
                              ...old,
                              [e.id]: event.target.value as DirectoryChoice,
                            }));
                            unreview();
                          }}
                        >
                          {options.map((action) => (
                            <option key={action} value={action}>
                              {t("tandem.directoryTask.choices." + action)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {e.kind !== "excluded" && (
                        <label className="block">
                          {t("tandem.directoryTask.rename")}
                          <input
                            className="w-full min-w-0 rounded border border-border p-1"
                            aria-label={t("tandem.directoryTask.renameFor", {
                              name: e.relativePath,
                            })}
                            value={
                              renames[e.sourceRelativePath] ??
                              e.relativePath.split("/").at(-1) ??
                              ""
                            }
                            maxLength={255}
                            disabled={loading}
                            onChange={(event) => {
                              setRenames((old) => ({
                                ...old,
                                [e.sourceRelativePath]: event.target.value,
                              }));
                              unreview();
                            }}
                          />
                        </label>
                      )}
                    </>
                  ) : (
                    <p>
                      {t("tandem.directoryTask.action")}:{" "}
                      {t(
                        "tandem.directoryTask.choices." +
                          (choice ?? e.action ?? "skip"),
                      )}
                    </p>
                  )}
                  {e.operation && (
                    <p>
                      {t("tandem.directoryTask.operationState")}:{" "}
                      {t(
                        "tandem.collaboration.operations." + e.operation.status,
                      )}
                    </p>
                  )}
                  {e.operation?.auditGap && (
                    <p role="alert" className="text-amber-500">
                      {t("tandem.collaboration.errors.AUDIT_UNAVAILABLE")}
                    </p>
                  )}
                  {e.result && (
                    <p>
                      {t("tandem.directoryTask.physicalResult")}:{" "}
                      {t("tandem.collaboration.operations." + e.result.status)}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              {t("tandem.directoryTask.previous")}
            </Button>
            <span className="text-xs">
              {t("tandem.directoryTask.page", {
                from: page.entries ? offset + 1 : 0,
                to: Math.min(offset + 100, page.entries),
                total: page.entries,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page.nextOffset === null}
              onClick={() => setOffset(page.nextOffset!)}
            >
              {t("tandem.directoryTask.next")}
            </Button>
          </div>
          {onReview && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={reviewed.has(offset)}
                disabled={loading || !!error}
                onChange={(event) =>
                  setReviewed((old) => {
                    const copy = new Set(old);
                    if (event.target.checked) copy.add(offset);
                    else copy.delete(offset);
                    return copy;
                  })
                }
              />
              {t("tandem.directoryTask.reviewPage")}
            </label>
          )}
        </>
      )}
    </section>
  );
}
