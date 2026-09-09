import { getFileManagerApiForSession } from "@/main-axios";
import { nativeDownloadValue } from "./file-download-api";
import type {
  DownloadBatchSummary,
  DownloadBatchDetail,
  RestoredDownloadBatch,
} from "@/types/download-batch-recovery";
import type { LocalDownloadView } from "@/types/file-download";
async function request<T>(
  sessionId: string,
  kind: string,
  intent: object = {},
  args: Record<string, unknown> = {},
) {
  const native = window.electronAPI?.downloadDirectories?.recovery,
    identityApi = window.electronAPI?.downloads?.recovery;
  if (!native || !identityApi) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
  const identity = nativeDownloadValue(await identityApi("identity")) as {
    windowToken: string;
  };
  const ticket = (
    await getFileManagerApiForSession(sessionId).post<{ ticketId: string }>(
      "/ssh/downloads/batches/recovery/ticket",
      { windowToken: identity.windowToken, kind, ...intent },
    )
  ).data;
  return nativeDownloadValue(await native(kind, ticket.ticketId, args)) as T;
}
export const downloadBatchRecoveryApi = {
  list: (s: string) => request<DownloadBatchSummary[]>(s, "list"),
  detail: (s: string, id: string) =>
    request<DownloadBatchDetail>(s, "detail", {}, { id }),
  save: (
    s: string,
    treeId: string,
    targetId: string,
    members: Array<{
      entryId: string;
      sourceId?: string;
      localId?: string;
      cancelled?: boolean;
    }>,
  ) =>
    request<DownloadBatchSummary>(
      s,
      "save",
      {
        treeId,
        sources: members
          .filter((m) => m.sourceId)
          .map((m) => ({ entryId: m.entryId, sourceId: m.sourceId })),
      },
      {
        targetId,
        members: members.map(({ entryId, localId, cancelled }) => ({
          entryId,
          localId,
          cancelled,
        })),
      },
    ),
  restore: (
    s: string,
    id: string,
    targetId: string,
    reviewed: boolean,
    overwrite: boolean,
  ) =>
    request<RestoredDownloadBatch>(
      s,
      "restore",
      { sessionId: s },
      { id, targetId, reviewed, overwrite },
    ),
  check: (s: string, id: string) =>
    request<{
      summary: DownloadBatchSummary;
      completed?: Array<{ entryId: string; local: LocalDownloadView }>;
    }>(s, "check", {}, { id }),
  discard: (s: string, id: string) =>
    request<DownloadBatchSummary>(s, "discard", {}, { id }),
  remove: (s: string, id: string) => request(s, "remove", {}, { id }),
};
