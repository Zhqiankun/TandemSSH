import { authApi } from "@/main-axios";
import type {
  SavedWorkflow,
  WorkflowDefinition,
  WorkflowPreview,
} from "@/types/workflow";
import type { CommandDecision } from "@/types/collaboration-operations";
import type { TaskMode, TaskView } from "@/types/collaboration-task";
export type WorkflowReview = WorkflowPreview & { decisions: CommandDecision[] };
export const workflowApi = {
  async list(signal?: AbortSignal) {
    return (
      await authApi.get<{ workflows: SavedWorkflow[] }>("/tandem/workflows", {
        signal,
      })
    ).data.workflows;
  },
  async save(input: {
    id?: string;
    expectedRevision?: number;
    definition: WorkflowDefinition;
    allowedHostIds: number[];
  }) {
    return (await authApi.post<SavedWorkflow>("/tandem/workflows", input)).data;
  },
  async remove(item: SavedWorkflow) {
    await authApi.delete("/tandem/workflows/" + item.id, {
      data: { expectedRevision: item.revision },
    });
  },
  async inspect(definition: unknown) {
    return (
      await authApi.post<{
        definition: WorkflowDefinition;
        warnings: string[];
      }>("/tandem/workflows/inspect-import", { definition })
    ).data;
  },
  async export(id: string) {
    return (
      await authApi.get<{ definition: WorkflowDefinition; warnings: string[] }>(
        "/tandem/workflows/" + id + "/export",
      )
    ).data;
  },
  async preview(
    id: string,
    sessionId: string,
    parameters: Record<string, unknown>,
  ) {
    return (
      await authApi.post<WorkflowReview>(
        "/tandem/workflows/" + id + "/preview",
        { sessionId, parameters },
      )
    ).data;
  },
  async start(previewId: string, requestId: string, mode: TaskMode) {
    return (
      await authApi.post<TaskView>("/tandem/workflows/start", {
        previewId,
        requestId,
        mode,
      })
    ).data;
  },
};
export function workflowError(error: unknown): {
  code: string;
  field?: string;
} {
  const e = error as {
    response?: { data?: { error?: string; field?: string } };
  };
  return {
    code:
      e?.response?.data?.error ??
      (error instanceof Error ? error.message : "WORKFLOW_REQUEST_FAILED"),
    field: e?.response?.data?.field,
  };
}
