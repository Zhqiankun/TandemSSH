import { authApi } from "@/main-axios";
import type {
  AuditHistoryQuery,
  AuditHistoryPage,
  AuditHistoryDetail,
} from "@/types/task-history";
export const taskHistoryApi = {
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
