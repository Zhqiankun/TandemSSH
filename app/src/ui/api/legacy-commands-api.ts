import { authApi } from "@/main-axios";
import type { LegacyTaskRequest } from "@/types/legacy-commands";
import type { TaskView } from "@/types/collaboration-task";
export async function requestLegacyTask(
  input: LegacyTaskRequest,
  signal?: AbortSignal,
): Promise<{ task: TaskView; notes: string[] }> {
  return (await authApi.post("/tandem/legacy/tasks", input, { signal })).data;
}
export function legacyErrorCode(error: unknown): string {
  const code = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof code === "string"
    ? code
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "TASK_REQUEST_FAILED";
}
