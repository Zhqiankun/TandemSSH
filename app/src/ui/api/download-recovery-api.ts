import { getFileManagerApiForSession } from "@/main-axios";
import { nativeDownloadValue } from "./file-download-api";
import type {
  DownloadRecoverySummary,
  RestoredDownload,
} from "@/types/download-recovery";
import type { LocalDownloadView } from "@/types/file-download";
async function action<T>(
  sessionId: string,
  kind: string,
  intent: Record<string, unknown> = {},
  args: Record<string, unknown> = {},
) {
  const native = window.electronAPI?.downloads?.recovery;
  if (!native) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
  const identity = nativeDownloadValue(await native("identity")) as {
    windowToken: string;
  };
  const ticket = (
    await getFileManagerApiForSession(sessionId).post<{ ticketId: string }>(
      "/ssh/downloads/recovery/ticket",
      { windowToken: identity.windowToken, kind, ...intent },
    )
  ).data;
  return nativeDownloadValue(await native(kind, ticket.ticketId, args)) as T;
}
export const downloadRecoveryApi = {
  list: (sessionId: string) =>
    action<DownloadRecoverySummary[]>(sessionId, "list"),
  save: (sessionId: string, sourceId: string, localId: string) =>
    action<DownloadRecoverySummary>(
      sessionId,
      "save",
      { sourceId },
      { localId },
    ),
  restore: (sessionId: string, id: string, overwrite: boolean) =>
    action<RestoredDownload>(
      sessionId,
      "restore",
      { sessionId },
      { id, overwrite },
    ),
  check: (sessionId: string, id: string) =>
    action<{ summary: DownloadRecoverySummary; local?: LocalDownloadView }>(
      sessionId,
      "check",
      {},
      { id },
    ),
  discard: (sessionId: string, id: string) =>
    action<DownloadRecoverySummary>(sessionId, "discard", {}, { id }),
  remove: (sessionId: string, id: string) =>
    action<{ removed: true }>(sessionId, "remove", {}, { id }),
};
