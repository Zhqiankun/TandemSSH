import type { FileChangeReview } from "@/types/file-automation";
import type { AiTaskView } from "@/types/ai-task";
import { authApi } from "@/main-axios";
import type { ControlSnapshot } from "@/types/collaboration";
import type { CommandPolicySnapshot } from "@/types/collaboration-operations";
import type {
  CollaborationTarget,
  TaskAuthorization,
  TaskCommand,
  TaskMode,
  TaskView,
  TaskOperation,
} from "@/types/collaboration-task";
export interface CollaborationSession {
  id: string;
  hostId: number;
  hostName: string;
  connected: boolean;
  control: ControlSnapshot;
}
export const collaborationApi = {
  async targets(signal?: AbortSignal) {
    return (
      await authApi.get<{ targets: CollaborationTarget[] }>("/tandem/targets", {
        signal,
      })
    ).data.targets;
  },
  async snapshot(sessionId: string, signal?: AbortSignal) {
    const [tasks, sessions, policy, agents] = await Promise.all([
      authApi.get<{ tasks: TaskView[] }>("/tandem/tasks", {
        params: { sessionId, operationLimit: 0 },
        signal,
      }),
      authApi.get<{ sessions: CollaborationSession[] }>("/tandem/sessions", {
        signal,
      }),
      authApi.get<CommandPolicySnapshot>("/tandem/policy", { signal }),
      authApi.get<{ runs: AiTaskView[] }>("/tandem/ai-tasks", {
        params: { sessionId },
        signal,
      }),
    ]);
    return {
      tasks: tasks.data.tasks,
      agents: agents.data.runs,
      session: sessions.data.sessions.find((s) => s.id === sessionId),
      policy: policy.data,
    };
  },
  async taskPage(id: string, operationOffset?: number, signal?: AbortSignal) {
    return (
      await authApi.get<TaskView>("/tandem/tasks/" + encodeURIComponent(id), {
        params: { operationLimit: 50, operationOffset },
        signal,
      })
    ).data;
  },
  async operationDetail(taskId: string, id: string, signal?: AbortSignal) {
    return (
      await authApi.get<TaskOperation>(
        "/tandem/tasks/" +
          encodeURIComponent(taskId) +
          "/operations/" +
          encodeURIComponent(id),
        { signal },
      )
    ).data;
  },
  async create(input: {
    sessionId: string;
    requestId: string;
    title: string;
    mode: TaskMode;
    commands?: TaskCommand[];
  }) {
    return (await authApi.post<TaskView>("/tandem/tasks", input)).data;
  },
  async authorize(id: string, input: TaskAuthorization) {
    return (
      await authApi.post<TaskView>(
        "/tandem/tasks/" + id + "/authorize",
        input,
        { params: { operationLimit: 50 } },
      )
    ).data;
  },
  async approve(
    id: string,
    input: {
      operationId: string;
      digest: string;
      policyRevision: number;
      fileReviewId?: string;
    },
  ) {
    return (
      await authApi.post<TaskView>("/tandem/tasks/" + id + "/approve", input, {
        params: { operationLimit: 50 },
      })
    ).data;
  },
  async fileReview(taskId: string, operationId: string, signal?: AbortSignal) {
    return (
      await authApi.get<FileChangeReview>(
        "/tandem/tasks/" + taskId + "/file-review/" + operationId,
        { signal },
      )
    ).data;
  },
  async archive(id: string) {
    return (
      await authApi.post<{ id: string; archived: boolean }>(
        "/tandem/tasks/" + encodeURIComponent(id) + "/archive",
        {},
      )
    ).data;
  },
  async finish(id: string) {
    return (
      await authApi.post<TaskView>(
        "/tandem/tasks/" + id + "/finish",
        {},
        { params: { operationLimit: 50 } },
      )
    ).data;
  },
  async cancel(id: string) {
    return (
      await authApi.post<TaskView>(
        "/tandem/tasks/" + id + "/cancel",
        {},
        { params: { operationLimit: 50 } },
      )
    ).data;
  },
  async takeover(sessionId: string) {
    await authApi.post("/tandem/sessions/" + sessionId + "/takeover");
  },
};
export function collaborationErrorCode(error: unknown): string {
  const response =
    error && typeof error === "object" && "response" in error
      ? (error as { response?: { data?: { error?: unknown } } }).response
      : undefined;
  return typeof response?.data?.error === "string"
    ? response.data.error
    : "CONNECTION_FAILED";
}
