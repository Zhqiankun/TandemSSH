import { getFileManagerApiForSession } from "@/main-axios";
import type { UploadManifest, UploadView } from "@/types/file-upload";
import type {
  UploadRecoverySummary,
  RestoredUpload,
} from "@/types/upload-recovery";
async function request<T>(
  sessionId: string,
  operation: string,
  body: Record<string, unknown> = {},
) {
  const native = window.electronAPI?.uploadSources?.recoveryIdentity;
  if (!native) throw Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED");
  const identity = await native();
  if (identity.ok === false) throw Error(identity.error);
  return (
    await getFileManagerApiForSession(sessionId).post<T>(
      "/ssh/uploads/recovery/" + operation,
      { windowToken: identity.value.windowToken, ...body },
      { timeout: 0 },
    )
  ).data;
}
export const uploadRecoveryApi = {
  list: (s: string) => request<UploadRecoverySummary[]>(s, "list"),
  detail: (s: string, id: string) =>
    request<{ summary: UploadRecoverySummary; manifest: UploadManifest }>(
      s,
      "detail",
      { id },
    ),
  save: (s: string, id: string) =>
    request<UploadRecoverySummary>(s, "save", { id }),
  restore: (
    s: string,
    id: string,
    manifest: UploadManifest,
    overwrite: boolean,
  ) =>
    request<RestoredUpload>(s, "restore", {
      id,
      sessionId: s,
      manifest,
      overwrite,
    }),
  check: (s: string, id: string, takeover: boolean) =>
    request<{ summary: UploadRecoverySummary; view?: UploadView }>(s, "check", {
      id,
      sessionId: s,
      takeover,
    }),
  discard: (s: string, id: string, takeover: boolean) =>
    request<UploadRecoverySummary>(s, "discard", {
      id,
      sessionId: s,
      takeover,
    }),
  remove: (s: string, id: string) =>
    request<{ removed: true }>(s, "remove", { id }),
};
