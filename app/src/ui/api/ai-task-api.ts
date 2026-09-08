import { authApi } from "@/main-axios";
import type { AiTaskView, CreateAiTask } from "@/types/ai-task";
import type { TaskView } from "@/types/collaboration-task";
export const aiTaskApi = {
  async create(input: CreateAiTask) {
    return (
      await authApi.post<{ task: TaskView; run: AiTaskView }>(
        "/tandem/ai-tasks",
        input,
      )
    ).data;
  },
  async reply(id: string, questionId: string, answer: string) {
    return (
      await authApi.post<AiTaskView>("/tandem/ai-tasks/" + id + "/reply", {
        questionId,
        answer,
      })
    ).data;
  },
  async budget(id: string, maxTurns: number) {
    return (
      await authApi.post<AiTaskView>("/tandem/ai-tasks/" + id + "/budget", {
        maxTurns,
      })
    ).data;
  },
  async stop(id: string) {
    return (await authApi.post<AiTaskView>("/tandem/ai-tasks/" + id + "/stop"))
      .data;
  },
};
