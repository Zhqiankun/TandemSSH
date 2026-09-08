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
  }, [userId]);
  useEffect(
    () => () => {
      uploadQueue.resetForSignOut();
    },
    [],
  );
  useEffect(() => {
    const current = new Set(jobs.map((j) => j.id));
    for (const id of seen.current.keys())
      if (!current.has(id)) seen.current.delete(id);
    for (const j of jobs) {
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
  return null;
}
