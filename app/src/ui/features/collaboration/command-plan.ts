import type { TaskCommand } from "@/types/collaboration-task";
export {
  CommandPlanError,
  parseCommandPlan,
} from "../../../domain/commands/parse-plan";
export function displayCommand(command: TaskCommand): string {
  return [command.program, ...command.args]
    .map((part) =>
      /^[a-zA-Z0-9_./:@%+=,-]+$/.test(part)
        ? part
        : "'" + part.replaceAll("'", "'\\''") + "'",
    )
    .join(" ");
}
