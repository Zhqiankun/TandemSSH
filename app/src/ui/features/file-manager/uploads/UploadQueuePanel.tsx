import { UploadBatchRecoveryDialog } from "./UploadBatchRecoveryDialog";
import { UploadRecoveryDialog } from "./UploadRecoveryDialog";
import { uploadRecoveryApi } from "@/api/upload-recovery-api";
import { uploadBatches } from "./upload-batches";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { toast } from "sonner";
import { uploadErrorCode } from "@/api/file-upload-api";
import { uploadQueue, type UploadJobView, type UploadQueue } from "./queue";
function UploadRow({
  job,
  sessionId,
  queue,
}: {
  job: UploadJobView;
  sessionId?: string;
  queue: UploadQueue;
}) {
  const { t } = useTranslation(),
    [overwrite, setOverwrite] = useState(false),
    [name, setName] = useState(job.path.split("/").at(-1) ?? job.name),
    transfer = job.transfer;
  const done = transfer?.receivedBytes ?? 0,
    percent = job.size
      ? Math.min(100, Math.floor((done * 100) / job.size))
      : job.state === "completed"
        ? 100
        : 0;
  const error = job.error
    ? t("tandem.upload.errors." + job.error, {
        defaultValue: t("tandem.collaboration.errors." + job.error, {
          defaultValue: t("tandem.upload.failed"),
        }),
      })
    : undefined;
  const resume = (takeover = false) =>
    queue.resume(job.id, sessionId ?? job.sessionId, takeover);
  return (
    <article
      className="rounded border border-border bg-background p-3 text-xs space-y-2"
      aria-label={job.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-all">{job.name}</strong>
        <span>{t("tandem.upload.states." + job.state)}</span>
      </div>
      <p className="select-text break-all">
        {transfer?.hostIdentity ?? job.hostLabel} ·{" "}
        {transfer?.canonicalPath ?? job.path}
      </p>
      {job.kind === "directory" ? (
        <p>{t("tandem.uploadTree.directory")}</p>
      ) : job.state === "checking" ? (
        <p>
          {t("tandem.upload.sourceProgress", {
            bytes: job.sourceCheckedBytes,
            total: job.size,
          })}
        </p>
      ) : (
        <>
          <progress
            className="w-full"
            max={100}
            value={percent}
            aria-label={t("tandem.upload.progress")}
          />
          <p>
            {t("tandem.upload.confirmedBytes", {
              bytes: done,
              total: job.size,
            })}
            {job.speed && job.state === "uploading"
              ? " · " +
                t("tandem.upload.speed", {
                  speed: Math.round(job.speed / 1024),
                  seconds: Math.max(
                    0,
                    Math.ceil((job.size - done) / job.speed),
                  ),
                })
              : ""}
          </p>
        </>
      )}
      {transfer?.temporaryPath && (
        <p className="select-text break-all">
          {t("fileDocument.temporary")} {transfer.temporaryPath}
        </p>
      )}
      {error && (
        <p role="alert" className="text-amber-500">
          {error}
        </p>
      )}
      {job.state === "awaiting-review" && (
        <>
          <p>
            {transfer?.existing
              ? t("tandem.upload.existing", { size: transfer.existing.size })
              : t("tandem.upload.missing")}
          </p>
          {transfer?.existing && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              {t("tandem.upload.overwrite")}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-32 flex-1"
              aria-label={t("tandem.upload.targetName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void queue.repreview(job.id, name, sessionId).catch((e) =>
                  toast.error(
                    t("tandem.upload.errors." + uploadErrorCode(e), {
                      defaultValue: t("tandem.upload.failed"),
                    }),
                  ),
                )
              }
            >
              {t("tandem.upload.renamePreview")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!transfer?.existing && !overwrite}
              onClick={() =>
                queue.start(
                  job.id,
                  overwrite,
                  job.error === "FILE_AUTOMATION_ACTIVE",
                )
              }
            >
              {t(
                job.error === "FILE_AUTOMATION_ACTIVE"
                  ? "tandem.upload.takeoverStart"
                  : "tandem.upload.start",
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void queue.cancel(job.id, true)}
            >
              {t("tandem.upload.skip")}
            </Button>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {job.state === "uploading" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => queue.pause(job.id)}
          >
            {t("tandem.upload.pause")}
          </Button>
        )}
        {["paused", "failed"].includes(job.state) &&
          transfer?.temporaryPath && (
            <Button
              size="sm"
              onClick={() => resume(job.error === "FILE_AUTOMATION_ACTIVE")}
            >
              {t(
                job.error === "FILE_AUTOMATION_ACTIVE"
                  ? "tandem.upload.takeoverResume"
                  : "tandem.upload.resume",
              )}
            </Button>
          )}
        {job.state === "paused" &&
          !job.batchId &&
          window.electronAPI?.uploadSources?.recoveryIdentity && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void queue
                  .suspend(job.id, (id) =>
                    uploadRecoveryApi.save(job.sessionId, id),
                  )
                  .catch((e) =>
                    toast.error(
                      t("uploadRecovery.errors." + uploadErrorCode(e), {
                        defaultValue: t("uploadRecovery.failed"),
                      }),
                    ),
                  )
              }
            >
              {t("uploadRecovery.save")}
            </Button>
          )}
        {job.state === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void queue
                .repreview(
                  job.id,
                  undefined,
                  sessionId,
                  job.error === "FILE_AUTOMATION_ACTIVE",
                )
                .catch(() => toast.error(t("tandem.upload.failed")))
            }
          >
            {t(
              job.error === "FILE_AUTOMATION_ACTIVE"
                ? "tandem.upload.takeoverStart"
                : "tandem.upload.repreview",
            )}
          </Button>
        )}
        {[
          "queued",
          "checking",
          "uploading",
          "pausing",
          "paused",
          "failed",
        ].includes(job.state) &&
          job.kind !== "directory" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void queue.cancel(job.id)}
            >
              {t("tandem.upload.cancel")}
            </Button>
          )}
      </div>
      {job.state === "unknown" && <p>{t("tandem.upload.unknownHint")}</p>}
      {job.state === "completed" && job.kind !== "directory" && (
        <details>
          <summary>{t("tandem.upload.verified")}</summary>
          <code className="select-text break-all">
            SHA-256 {transfer?.sha256}
          </code>
        </details>
      )}
    </article>
  );
}
export function UploadQueuePanel({
  sessionId,
  hostId,
  onRefresh,
  queue = uploadQueue,
}: {
  sessionId?: string;
  hostId?: number;
  onRefresh: () => void;
  queue?: UploadQueue;
}) {
  const { t } = useTranslation(),
    jobs = useSyncExternalStore(
      queue.subscribe,
      queue.getSnapshot,
      queue.getSnapshot,
    ),
    seen = useRef(new Set<string>());
  const batches = useSyncExternalStore(
    uploadBatches.subscribe,
    uploadBatches.getSnapshot,
    uploadBatches.getSnapshot,
  );
  const [page, setPage] = useState(0),
    pages = Math.max(1, Math.ceil(jobs.length / 100)),
    currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    for (const j of jobs)
      if (j.state === "completed" && !seen.current.has(j.id)) {
        seen.current.add(j.id);
        if (j.hostId === hostId) onRefresh();
      }
  }, [jobs, hostId, onRefresh]);
  if (!jobs.length)
    return window.electronAPI?.uploadSources?.recoveryIdentity ? (
      <div className="border-t border-border p-2">
        {queue === uploadQueue && (
          <UploadBatchRecoveryDialog
            key={(queue.getOwner() ?? "") + "batch"}
            sessionId={sessionId}
            hostId={hostId}
          />
        )}
        <UploadRecoveryDialog
          key={queue.getOwner() ?? ""}
          sessionId={sessionId}
          hostId={hostId}
          queue={queue}
        />
      </div>
    ) : null;
  return (
    <section
      className="max-h-80 shrink-0 overflow-auto border-t border-border bg-background p-3"
      aria-label={t("tandem.upload.title")}
    >
      <details open>
        <summary className="cursor-pointer text-sm font-medium">
          {t("tandem.upload.title")} · {jobs.length}
        </summary>
        <div className="flex flex-wrap items-center gap-3 py-2 text-xs">
          <label className="flex items-center gap-2">
            {t("tandem.upload.concurrency")}
            <input
              className="w-14 rounded border border-border bg-background px-2 py-1"
              aria-label={t("tandem.upload.concurrency")}
              type="number"
              min={1}
              max={4}
              value={queue.getConcurrency()}
              onChange={(e) => queue.setConcurrency(Number(e.target.value))}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queue.removeFinished()}
          >
            {t("tandem.upload.clearFinished")}
          </Button>
          {queue === uploadQueue && (
            <UploadBatchRecoveryDialog
              key={(queue.getOwner() ?? "") + "batch"}
              sessionId={sessionId}
              hostId={hostId}
            />
          )}
          <UploadRecoveryDialog
            key={queue.getOwner() ?? ""}
            sessionId={sessionId}
            hostId={hostId}
            queue={queue}
          />
          <p>{t("tandem.upload.memoryHint")}</p>
        </div>
        {queue === uploadQueue &&
          batches.map((batch) => (
            <div
              key={batch.id}
              className="my-2 rounded border border-border p-2 text-xs"
            >
              <strong>{batch.name}</strong>
              <p className="break-all">{batch.target}</p>
              <p>
                {t("tandem.uploadTree.batchProgress", {
                  completed: batch.completed,
                  total: batch.total,
                  failed: batch.failed,
                  unknown: batch.unknown,
                  skipped: batch.skipped,
                })}
              </p>
              <p>{t("uploadBatchRecovery.batchStates." + batch.state)}</p>
              {["creating", "running", "paused"].includes(batch.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void uploadBatches
                      .save(batch.id)
                      .catch(() => toast.error(t("uploadBatchRecovery.failed")))
                  }
                >
                  {t("uploadBatchRecovery.save")}
                </Button>
              )}
              {batch.state === "paused" && (
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      void uploadBatches
                        .resumeBatch(batch.id)
                        .catch(() =>
                          toast.error(t("uploadBatchRecovery.failed")),
                        )
                    }
                  >
                    {t("uploadBatchRecovery.continue")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void uploadBatches
                        .resumeBatch(batch.id, true)
                        .catch(() =>
                          toast.error(t("uploadBatchRecovery.failed")),
                        )
                    }
                  >
                    {t("uploadBatchRecovery.takeoverContinue")}
                  </Button>
                </>
              )}
              {batch.error && (
                <p role="alert" className="text-amber-500">
                  {t("uploadBatchRecovery.errors." + batch.error, {
                    defaultValue: t("tandem.upload.errors." + batch.error, {
                      defaultValue: t("tandem.upload.failed"),
                    }),
                  })}
                </p>
              )}
              {(["creating", "running", "paused"].includes(batch.state) ||
                (batch.state === "finished" && batch.failed > 0)) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void uploadBatches
                      .cancel(batch.id)
                      .catch(() => toast.error(t("tandem.upload.failed")))
                  }
                >
                  {t("tandem.uploadTree.cancelBatch")}
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
              {t("tandem.uploadTree.previous")}
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
              {t("tandem.uploadTree.next")}
            </Button>
          </div>
        )}
        <div className="grid gap-2">
          {jobs.slice(currentPage * 100, (currentPage + 1) * 100).map((job) => (
            <UploadRow
              key={job.id}
              queue={queue}
              job={job}
              sessionId={job.hostId === hostId ? sessionId : undefined}
            />
          ))}
        </div>
      </details>
    </section>
  );
}
