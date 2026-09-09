import { getFileManagerApiForSession } from "@/main-axios";
import type {
  UploadBatchRecoverySummary,
  RestoredUploadBatch,
  UploadBatchMemberState,
} from "@/types/upload-batch-recovery";
import type { UploadTreeEntry, UploadTreePreview } from "@/types/upload-tree";
async function request<T>(
  session: string,
  operation: string,
  body: object = {},
) {
  const native = window.electronAPI?.uploadSources?.recoveryIdentity;
  if (!native) throw Error("UPLOAD_BATCH_DESKTOP_REQUIRED");
  const identity = await native();
  if (identity.ok === false) throw Error(identity.error);
  return (
    await getFileManagerApiForSession(session).post<T>(
      "/ssh/uploads/batches/recovery/" + operation,
      { ...body, windowToken: identity.value.windowToken },
      { timeout: 0 },
    )
  ).data;
}
export const uploadBatchRecoveryApi = {
  list: (s: string) => request<UploadBatchRecoverySummary[]>(s, "list"),
  detail: (s: string, id: string) =>
    request<{
      summary: UploadBatchRecoverySummary;
      entries: UploadTreeEntry[];
      members: Array<{ entryId: string; state: UploadBatchMemberState }>;
    }>(s, "detail", { id }),
  save: (
    s: string,
    input: {
      id: string;
      treeId: string;
      sourceId: string;
      members: Array<{
        entryId: string;
        uploadId?: string;
        cancelled?: boolean;
      }>;
    },
  ) => request<UploadBatchRecoverySummary>(s, "save", input),
  restore: (
    s: string,
    id: string,
    sourceId: string,
    reviewed: boolean,
    overwrite: boolean,
  ) =>
    request<RestoredUploadBatch>(s, "restore", {
      id,
      sessionId: s,
      sourceId,
      reviewed,
      overwrite,
    }),
  check: (s: string, id: string, takeover: boolean) =>
    request<{ summary: UploadBatchRecoverySummary; tree: UploadTreePreview }>(
      s,
      "check",
      { id, sessionId: s, takeover },
    ),
  discard: (s: string, id: string, takeover: boolean) =>
    request<UploadBatchRecoverySummary>(s, "discard", {
      id,
      sessionId: s,
      takeover,
    }),
  remove: (s: string, id: string) => request(s, "remove", { id }),
};
