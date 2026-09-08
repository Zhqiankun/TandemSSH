import type { HumanLocalFileGrant } from "@/types/local-file-grants";
import type { TaskFileStep, TaskFileBindings } from "@/types/task-plan";
// UI eligibility only; the task runtime revalidates each native grant before execution.
export function matchingWorkflowGrants(
  taskId: string,
  steps: TaskFileStep[],
  name: string,
  grants: HumanLocalFileGrant[],
) {
  const uses = steps.filter((s) => s.localFile === name),
    direction = uses[0]?.direction;
  return grants.filter(
    (g) =>
      g.kind !== "directory" &&
      g.taskId === taskId &&
      g.state === "active" &&
      g.expiresAt > Date.now() &&
      g.direction === direction &&
      (!uses.some((s) => s.overwrite) || g.allowOverwrite),
  );
}
export function workflowBindingsReady(
  taskId: string,
  steps: TaskFileStep[],
  bindings: TaskFileBindings,
  grants: HumanLocalFileGrant[],
) {
  const downloads = new Set<string>();
  return [...new Set(steps.map((s) => s.localFile))].every((name) => {
    const binding = bindings[name],
      grant = matchingWorkflowGrants(taskId, steps, name, grants).find(
        (g) =>
          g.id === binding?.localGrantId && g.version === binding.localVersion,
      );
    if (!grant) return false;
    if (grant.direction === "download") {
      if (downloads.has(grant.id)) return false;
      downloads.add(grant.id);
    }
    return true;
  });
}
