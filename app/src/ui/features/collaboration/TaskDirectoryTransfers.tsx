import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { directoryTransferApi } from "@/api/directory-transfer-api";
import { localFileError } from "@/api/local-file-grants-api";
import type {
  DirectoryPreviewView,
  DirectoryRunView,
} from "@/types/directory-transfer";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import {
  DirectoryTransferManifest,
  type DirectoryReviewState,
} from "./DirectoryTransferManifest";
export function TaskDirectoryTransfers({
  taskId,
  grants,
  ready,
  disabled,
  onChange,
  onActiveChange,
  operationVersion,
}: {
  taskId: string;
  operationVersion?: string;
  grants: HumanLocalFileGrant[];
  ready: boolean;
  disabled: boolean;
  onChange: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [previews, setPreviews] = useState<DirectoryPreviewView[]>([]),
    [runs, setRuns] = useState<DirectoryRunView[]>([]),
    [selected, setSelected] = useState("");
  const [grantId, setGrantId] = useState(""),
    [remotePath, setRemotePath] = useState(""),
    [overwrite, setOverwrite] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [review, setReview] = useState<DirectoryReviewState>();
  const requested = useRef<Set<string> | null>(null);
  const owned = useRef(true);
  const activeNotify = useRef(onActiveChange);
  activeNotify.current = onActiveChange;
  useEffect(() => {
    activeNotify.current?.(runs.some((r) => !r.endedAt));
  }, [runs]);
  const notify = useRef(onChange);
  notify.current = onChange;
  const selectLatest = (rows: DirectoryPreviewView[]) => {
    const fresh = requested.current
      ? rows.filter((p) => !requested.current!.has(p.id)).at(-1)
      : undefined;
    if (fresh) {
      requested.current = null;
      setSelected(fresh.id);
      setReview(undefined);
    } else
      setSelected((old) =>
        rows.some((p) => p.id === old) ? old : (rows.at(-1)?.id ?? ""),
      );
  };
  const refresh = async () => {
    const data = await directoryTransferApi.snapshot(taskId);
    if (owned.current) {
      setPreviews(data.previews);
      setRuns(data.runs);
      selectLatest(data.previews);
    }
  };
  useEffect(() => {
    owned.current = true;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await directoryTransferApi.snapshot(taskId, stop.signal);
        if (owned.current) {
          setPreviews(data.previews);
          setRuns(data.runs);
          selectLatest(data.previews);
        }
      } catch (e) {
        if (owned.current) setError(localFileError(e));
      }
      if (owned.current) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      owned.current = false;
      stop.abort();
      clearTimeout(timer);
    };
  }, [taskId]);
  const available = grants.filter(
    (g) => g.kind === "directory" && g.state === "active",
  );
  const grant = available.find((g) => g.id === grantId) ?? available[0];
  const preview = previews.find((p) => p.id === selected),
    run = runs.find((r) => r.previewId === selected),
    active = runs.some((r) => !r.endedAt);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      if (owned.current) {
        await refresh();
        notify.current();
      }
    } catch (e) {
      if (owned.current) setError(localFileError(e));
    } finally {
      if (owned.current) setBusy(false);
    }
  };
  const makePreview = () => {
    if (!grant) return;
    requested.current = new Set(previews.map((p) => p.id));
    void act(() =>
      directoryTransferApi.preview(taskId, {
        requestId: crypto.randomUUID(),
        direction: grant.direction,
        localGrantId: grant.id,
        localVersion: grant.version,
        path: remotePath.trim(),
        overwrite: overwrite && grant.allowOverwrite,
      }),
    );
  };
  const repreview = () => {
    if (!preview || !review) return;
    requested.current = new Set(previews.map((p) => p.id));
    void act(() =>
      directoryTransferApi.preview(taskId, {
        requestId: crypto.randomUUID(),
        direction: preview.direction,
        path: preview.path,
        localGrantId: preview.localGrantId,
        localVersion: preview.localVersion,
        overwrite: preview.overwrite,
        renames: review.renames,
        timeoutMs: preview.timeoutMs,
      }),
    );
  };
  const canRun = ready && !disabled && !busy && !active;
  return (
    <section
      className="my-3 space-y-3 rounded border border-border p-3"
      aria-label={t("tandem.directoryTask.title")}
    >
      <h3 className="text-sm font-medium">{t("tandem.directoryTask.title")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("tandem.directoryTask.hint")}
      </p>
      {!available.length ? (
        <p className="text-xs">{t("tandem.directoryTask.chooseFirst")}</p>
      ) : (
        <div className="space-y-2 text-xs">
          <label className="block">
            {t("tandem.directoryTask.localGrant")}
            <select
              className="w-full min-w-0"
              value={grant?.id ?? ""}
              disabled={busy || disabled}
              onChange={(e) => {
                setGrantId(e.target.value);
                setOverwrite(false);
              }}
            >
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {t("tandem.directoryTask.direction." + g.direction)} ·{" "}
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {grant && (
            <p className="break-all select-text text-muted-foreground">
              {grant.path}
            </p>
          )}
          <label className="block">
            {t(
              grant?.direction === "upload"
                ? "tandem.directoryTask.remoteParent"
                : "tandem.directoryTask.remoteSource",
            )}
            <input
              className="w-full min-w-0 rounded border border-border p-2"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder="/srv"
              maxLength={4096}
              disabled={busy || disabled}
              spellCheck={false}
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={overwrite && !!grant?.allowOverwrite}
              disabled={busy || disabled || !grant?.allowOverwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            {t("tandem.directoryTask.allowOverwrite")}
          </label>
          {!ready && !disabled && (
            <p>{t("tandem.directoryTask.authorizeFirst")}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canRun || !remotePath.trim().startsWith("/")}
            onClick={makePreview}
          >
            {t("tandem.directoryTask.preview")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-amber-500">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.directoryTask.failed"),
          })}
        </p>
      )}
      {!!previews.length && (
        <label className="block text-xs">
          {t("tandem.directoryTask.previews")}
          <select
            className="w-full min-w-0"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setReview(undefined);
            }}
          >
            {previews.map((p, i) => (
              <option key={p.id} value={p.id}>
                {i + 1}. {t("tandem.directoryTask.direction." + p.direction)} ·{" "}
                {p.path}
              </option>
            ))}
          </select>
        </label>
      )}
      {preview && (
        <>
          <p className="break-all select-text text-xs">
            {t("tandem.directoryTask.previewBinding")}:{" "}
            {grants.find(
              (g) =>
                g.id === preview.localGrantId &&
                g.version === preview.localVersion,
            )?.path ?? t("tandem.transfer.localUnavailable")}
          </p>
          {preview.expiresAt <= Date.now() && (
            <p className="text-xs text-amber-500">
              {t("tandem.collaboration.errors.DIRECTORY_PREVIEW_EXPIRED")}
            </p>
          )}
          {preview.assigned && !run && (
            <p className="text-xs text-muted-foreground">
              {t("tandem.workflow.directoryInUse")}
            </p>
          )}
          {run && (
            <div
              role="status"
              className="space-y-1 rounded bg-muted p-2 text-xs"
            >
              <strong>
                {t("tandem.directoryTask.runStates." + run.state)}
              </strong>
              <p>
                {t("tandem.directoryTask.progress", {
                  done: run.completed,
                  total: run.total,
                })}
              </p>
              {run.error && (
                <p className="text-amber-500">
                  {t("tandem.collaboration.errors." + run.error, {
                    defaultValue: t("tandem.directoryTask.failed"),
                  })}
                </p>
              )}
              {run.state === "paused-human" && (
                <p>{t("tandem.directoryTask.takeoverHint")}</p>
              )}
            </div>
          )}
          <DirectoryTransferManifest
            key={preview.id}
            taskId={taskId}
            previewId={preview.id}
            editable={!preview.assigned && !run && preview.state === "preview"}
            refreshKey={
              run
                ? [run.state, run.operationId, run.completed].join(":")
                : [preview.state, preview.inUse, operationVersion].join(":")
            }
            onReview={!preview.assigned && !run ? setReview : undefined}
          />
          <div className="flex flex-wrap gap-2">
            {!preview.assigned && !run && preview.state === "preview" && (
              <>
                {review?.hasRenames ? (
                  <Button
                    size="sm"
                    disabled={
                      !canRun || !review.renames.every((r) => r.name.trim())
                    }
                    onClick={repreview}
                  >
                    {t("tandem.directoryTask.applyRenames")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={
                      !canRun ||
                      preview.expiresAt <= Date.now() ||
                      !review?.ready ||
                      review.revision !== preview.revision
                    }
                    onClick={() =>
                      void act(() =>
                        directoryTransferApi.run(taskId, {
                          previewId: preview.id,
                          revision: preview.revision,
                          choices: review!.choices,
                          requestId: crypto.randomUUID(),
                        }),
                      )
                    }
                  >
                    {t("tandem.directoryTask.run")}
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !!preview.inUse || (!!run && !run.endedAt)}
              onClick={() =>
                void act(() => directoryTransferApi.release(taskId, preview.id))
              }
            >
              {t("tandem.directoryTask.release")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
