import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { downloadBatches } from "./download-batches";
import { Button } from "@/components/button";
import {
  downloadQueue,
  type DownloadJobView,
  type DownloadQueue,
} from "./queue";
function DownloadRow({
  job,
  queue,
  sessionId,
}: {
  job: DownloadJobView;
  queue: DownloadQueue;
  sessionId?: string;
}) {
  const { t } = useTranslation(),
    [overwrite, setOverwrite] = useState(false);
  const action = (work: () => unknown | Promise<unknown>) => {
    void Promise.resolve()
      .then(work)
      .catch(() => toast.error(t("tandem.download.failed")));
  };
  return (
    <article
      className="rounded border border-border bg-background p-3 text-xs space-y-2"
      aria-label={job.name}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <strong className="break-all">{job.name}</strong>
        <span>{t("tandem.download.states." + job.state)}</span>
      </div>
      <p className="select-text break-all">
        {job.hostLabel} · {job.path}
      </p>
      {(job.local || job.localPath) && (
        <p className="select-text break-all">
          {t("tandem.download.target")} {job.local?.path ?? job.localPath}
        </p>
      )}
      <progress
        className="w-full"
        max={Math.max(1, job.size ?? 0)}
        value={
          job.state === "completed"
            ? Math.max(1, job.size ?? 0)
            : job.writtenBytes
        }
        aria-label={t("tandem.download.progress")}
      />
      <p>
        {job.kind === "directory"
          ? t("tandem.downloadTree.directoryStep")
          : t("tandem.download.bytes", {
              bytes: job.writtenBytes,
              total: job.size ?? "—",
            })}
        {job.speed && job.state === "downloading"
          ? " · " +
            t("tandem.upload.speed", {
              speed: Math.round(job.speed / 1024),
              seconds: Math.ceil(
                ((job.size ?? 0) - job.writtenBytes) / job.speed,
              ),
            })
          : ""}
      </p>
      {job.local?.temporaryPath && (
        <p className="select-text break-all">
          {t("fileDocument.temporary")} {job.local.temporaryPath}
        </p>
      )}
      {job.error && (
        <p role="alert" className="text-amber-500">
          {t("tandem.download.errors." + job.error, {
            defaultValue: t("tandem.collaboration.errors." + job.error, {
              defaultValue: t("tandem.download.failed"),
            }),
          })}
        </p>
      )}
      {job.state === "awaiting-review" && (
        <>
          <p>
            {t(
              job.local?.existing
                ? "tandem.download.existing"
                : "tandem.download.newTarget",
            )}
          </p>
          {job.local?.existing && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              {t("tandem.download.overwrite")}
            </label>
          )}
          <Button
            size="sm"
            disabled={!!job.local?.existing && !overwrite}
            onClick={() => queue.start(job.id, overwrite)}
          >
            {t("tandem.download.start")}
          </Button>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {job.state === "downloading" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => queue.pause(job.id)}
          >
            {t("tandem.upload.pause")}
          </Button>
        )}
        {["paused", "failed"].includes(job.state) &&
          job.local?.temporaryPath && (
            <Button size="sm" onClick={() => queue.resume(job.id, sessionId)}>
              {t("tandem.download.resume")}
            </Button>
          )}
        {job.state === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => action(() => queue.retry(job.id))}
          >
            {t(
              job.batchId
                ? "tandem.downloadTree.retryFile"
                : "tandem.download.retry",
            )}
          </Button>
        )}
        {![
          "completed",
          "unknown",
          "finalizing",
          "cancelled",
          "skipped",
        ].includes(job.state) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => action(() => queue.cancel(job.id))}
          >
            {t("tandem.upload.cancel")}
          </Button>
        )}
        {job.state === "completed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => action(() => queue.show(job.id))}
          >
            {t("tandem.download.show")}
          </Button>
        )}
      </div>
      {job.state === "unknown" && <p>{t("tandem.download.unknown")}</p>}
      {job.state === "completed" && job.kind !== "directory" && (
        <details>
          <summary>{t("tandem.upload.verified")}</summary>
          <code className="select-text break-all">
            SHA-256 {job.local?.sha256}
          </code>
        </details>
      )}
    </article>
  );
}
export function DownloadQueuePanel({
  sessionId,
  hostId,
  queue = downloadQueue,
}: {
  sessionId?: string;
  hostId?: number;
  queue?: DownloadQueue;
}) {
  const { t } = useTranslation(),
    jobs = useSyncExternalStore(
      queue.subscribe,
      queue.getSnapshot,
      queue.getSnapshot,
    );
  const batches = useSyncExternalStore(
    downloadBatches.subscribe,
    downloadBatches.getSnapshot,
    downloadBatches.getSnapshot,
  );
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(jobs.length / 100)),
    currentPage = Math.min(page, pages - 1);
  if (!jobs.length) return null;
  return (
    <section
      className="max-h-80 shrink-0 overflow-auto border-t border-border bg-background p-3"
      aria-label={t("tandem.download.title")}
    >
      <details open>
        <summary className="cursor-pointer text-sm font-medium">
          {t("tandem.download.title")} · {jobs.length}
        </summary>
        <div className="flex flex-wrap items-center gap-3 py-2 text-xs">
          <label className="flex items-center gap-2">
            {t("tandem.download.concurrency")}
            <input
              className="w-14 border border-border bg-background p-1"
              type="number"
              min={1}
              max={4}
              aria-label={t("tandem.download.concurrency")}
              value={queue.getConcurrency()}
              onChange={(e) => queue.setConcurrency(Number(e.target.value))}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queue.clearFinished()}
          >
            {t("tandem.upload.clearFinished")}
          </Button>
          <p>{t("tandem.download.memoryHint")}</p>
        </div>
        {queue === downloadQueue &&
          batches.map((batch) => (
            <div
              key={batch.id}
              className="my-2 rounded border border-border p-2 text-xs"
            >
              <strong>{batch.name}</strong>
              <p className="break-all">{batch.target}</p>
              <p>
                {t("tandem.downloadTree.batchProgress", {
                  completed: batch.completed,
                  total: batch.total,
                  failed: batch.failed,
                  unknown: batch.unknown,
                  skipped: batch.skipped,
                })}
              </p>
              {batch.error && (
                <p role="alert" className="text-amber-500">
                  {t("tandem.download.errors." + batch.error, {
                    defaultValue: t("tandem.download.failed"),
                  })}
                </p>
              )}
              {(["creating", "running"].includes(batch.state) ||
                (batch.state === "finished" && batch.failed > 0)) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void downloadBatches
                      .cancel(batch.id)
                      .catch(() => toast.error(t("tandem.download.failed")))
                  }
                >
                  {t("tandem.downloadTree.cancelBatch")}
                </Button>
              )}
            </div>
          ))}
        {pages > 1 && (
          <div className="flex items-center gap-2 my-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("tandem.downloadTree.previous")}
            </Button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("tandem.downloadTree.next")}
            </Button>
          </div>
        )}
        <div className="grid gap-2">
          {jobs.slice(currentPage * 100, (currentPage + 1) * 100).map((job) => (
            <DownloadRow
              key={job.id}
              job={job}
              queue={queue}
              sessionId={job.hostId === hostId ? sessionId : undefined}
            />
          ))}
        </div>
      </details>
    </section>
  );
}
export function DownloadQueueMonitor({ userId }: { userId: string | null }) {
  const { t } = useTranslation(),
    jobs = useSyncExternalStore(
      downloadQueue.subscribe,
      downloadQueue.getSnapshot,
      downloadQueue.getSnapshot,
    ),
    seen = useRef(new Map<string, string>());
  const batches = useSyncExternalStore(
    downloadBatches.subscribe,
    downloadBatches.getSnapshot,
    downloadBatches.getSnapshot,
  );
  const batchSeen = useRef(new Map<string, string>());
  useEffect(() => {
    const live = new Set(batches.map((b) => b.id));
    for (const id of batchSeen.current.keys())
      if (!live.has(id)) batchSeen.current.delete(id);
    for (const b of batches) {
      const previous = batchSeen.current.get(b.id);
      batchSeen.current.set(b.id, b.state);
      if (b.state === "finished" && previous !== "finished") {
        const message = t("tandem.downloadTree.batchNotice", {
          name: b.name,
          completed: b.completed,
          failed: b.failed,
          unknown: b.unknown,
          skipped: b.skipped,
        });
        if (b.failed || b.unknown) toast.warning(message);
        else toast.success(message);
      }
    }
  }, [batches, t]);
  useEffect(() => {
    downloadQueue.setOwner(userId);
    downloadBatches.setOwner(userId);
  }, [userId]);
  useEffect(
    () => () => {
      downloadBatches.setOwner(null);
      downloadQueue.setOwner(null);
    },
    [],
  );
  useEffect(() => {
    const live = new Set(jobs.map((j) => j.id));
    for (const id of seen.current.keys())
      if (!live.has(id)) seen.current.delete(id);
    for (const j of jobs) {
      if (j.batchId) continue;
      if (seen.current.get(j.id) === j.state) continue;
      seen.current.set(j.id, j.state);
      if (j.state === "completed")
        toast.success(t("tandem.download.completedNotice", { name: j.name }));
      else if (["failed", "unknown"].includes(j.state))
        toast.warning(t("tandem.download.attentionNotice", { name: j.name }));
    }
  }, [jobs, t]);
  return null;
}
