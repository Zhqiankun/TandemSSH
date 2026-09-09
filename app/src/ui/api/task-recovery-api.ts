import { authApi } from "@/main-axios";
import type {
  TaskRecoverySummary,
  TaskRecoveryDetail,
} from "@/types/task-recovery";
import type { TaskView } from "@/types/collaboration-task";
const path = (id: string) => "/tandem/recovery/" + encodeURIComponent(id);
export const taskRecoveryApi = {
  list: async () =>
    (await authApi.get<TaskRecoverySummary[]>("/tandem/recovery")).data,
  detail: async (id: string) =>
    (await authApi.get<TaskRecoveryDetail>(path(id))).data,
  save: async (id: string) =>
    (await authApi.post<TaskRecoverySummary>(path(id) + "/save")).data,
  restore: async (
    id: string,
    sessionId: string,
    reconciliation?: "retry" | "skip",
  ) =>
    (
      await authApi.post<TaskView>(path(id) + "/restore", {
        sessionId,
        reviewed: true,
        reconciliation,
      })
    ).data,
  remove: async (id: string) => {
    await authApi.delete(path(id));
  },
};
