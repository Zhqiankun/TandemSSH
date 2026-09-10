import {
  collectHistoryExport,
  type HistoryExportProgress,
} from "./history-export-stream";
import {
  AUDIT_EXPORT_LIMITS,
  type AuditExportQuery,
} from "@/types/task-history";
import { authApi } from "@/main-axios";
import type {
  AuditHistoryQuery,
  AuditHistoryPage,
  AuditHistoryDetail,
} from "@/types/task-history";
export const taskHistoryApi = {
  export: async (
    input: AuditExportQuery,
    signal: AbortSignal,
    progress?: (value: HistoryExportProgress) => void,
  ) => {
    const response = await authApi.post<ReadableStream<Uint8Array>>(
      "/tandem/history/export",
      input,
      {
        adapter: "fetch",
        responseType: "stream",
        signal,
        timeout: 120000,
        maxContentLength: AUDIT_EXPORT_LIMITS.bytes,
      },
    );
    if (
      !String(response.headers["content-type"]).startsWith(
        "application/x-ndjson",
      )
    ) {
      await response.data.cancel().catch(() => {});
      throw Error("HISTORY_EXPORT_INVALID");
    }
    return collectHistoryExport(response.data, signal, input.taskId, progress);
  },
  query: async (input: AuditHistoryQuery, signal?: AbortSignal) =>
    (
      await authApi.post<AuditHistoryPage>("/tandem/history/query", input, {
        signal,
      })
    ).data,
  detail: async (token: string, offset = 0, signal?: AbortSignal) =>
    (
      await authApi.post<AuditHistoryDetail>(
        "/tandem/history/detail",
        { token, offset },
        { signal },
      )
    ).data,
};
