import type { WorkflowDefinition } from "@/types/workflow";
export function createWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: "workflow-" + crypto.randomUUID(),
    name: "",
    version: "1.0.0",
    shellState: "explicit-cwd",
    parameters: {},
    defaults: {
      timeoutMs: 120000,
      onFailure: "stop",
      retry: { maxAttempts: 1 },
    },
    steps: [
      {
        id: "step-" + crypto.randomUUID(),
        name: "",
        action: { type: "command", program: "pwd", args: [] },
      },
    ],
  };
}
