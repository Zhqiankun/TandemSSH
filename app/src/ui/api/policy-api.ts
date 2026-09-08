import { authApi } from "@/main-axios";
import type {
  CommandPolicySnapshot,
  CommandPolicySet,
  CommandAction,
  CommandDecision,
} from "@/types/collaboration-operations";
import type { TaskCommand } from "@/types/collaboration-task";
export const policyApi = {
  async read(signal?: AbortSignal) {
    return (
      await authApi.get<CommandPolicySnapshot>("/tandem/policy", { signal })
    ).data;
  },
  async save(expectedRevision: number, sets: CommandPolicySet[]) {
    return (
      await authApi.put<CommandPolicySnapshot>("/tandem/policy", {
        expectedRevision,
        sets,
      })
    ).data;
  },
  async trial(input: {
    sessionId: string;
    taskId?: string;
    sets: CommandPolicySet[];
    command: TaskCommand;
  }) {
    return (
      await authApi.post<{
        decision: CommandDecision;
        action: CommandAction;
        policyRevision: number;
        target: { hostId: number; groupIds: string[]; taskId?: string };
      }>("/tandem/policy/trial", input)
    ).data;
  },
};
