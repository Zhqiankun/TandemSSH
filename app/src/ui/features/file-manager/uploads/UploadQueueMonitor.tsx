import { uploadBatches } from "./upload-batches";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { uploadQueue } from "./queue";
export function UploadQueueMonitor({ userId }: { userId: string | null }) {
  const { t } = useTranslation(),
    jobs = useSyncExternalStore(
      uploadQueue.subscribe,
      uploadQueue.getSnapshot,
      uploadQueue.getSnapshot,
    ),
    seen = useRef(new Map<string, string>());
  useEffect(() => {
    if (userId) uploadQueue.setOwner(userId);
    else uploadQueue.resetForSignOut();
    uploadBatches.setOwner(userId);
  }, [userId]);
  useEffect(
    () => () => {
      uploadBatches.setOwner(null);
      uploadQueue.resetForSignOut();
    },
    [],
  );
  useEffect(() => {
    const current = new Set(jobs.map((j) => j.id));
    for (const id of seen.current.keys())
      if (!current.has(id)) seen.current.delete(id);
    for (const j of jobs) {
      if (j.batchId) continue;
      const old = seen.current.get(j.id);
      seen.current.set(j.id, j.state);
      if (old === j.state) continue;
      if (j.state === "completed")
        toast.success(t("tandem.upload.completedNotice", { name: j.name }), {
          id: "upload-" + j.id,
        });
      else if (j.state === "failed" || j.state === "unknown")
        toast.warning(t("tandem.upload.attentionNotice", { name: j.name }), {
          id: "upload-" + j.id,
        });
    }
  }, [jobs, t]);
  const batches = useSyncExternalStore(
    uploadBatches.subscribe,
    uploadBatches.getSnapshot,
    uploadBatches.getSnapshot,
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
        const message = t("tandem.uploadTree.batchNotice", {
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
  return null;
}
