import type { TaskRuntime } from "../tasks/runtime.js";
import type { ControlSnapshot } from "../../../types/collaboration.js";
import type { LegacyTaskRequest } from "../../../types/legacy-commands.js";
import {
  compileLegacy,
  parseLegacySource,
  type LegacyHost,
} from "./compile.js";
export interface LegacyTarget {
  hostId: number;
  hostName: string;
  host: LegacyHost;
  control: ControlSnapshot;
}
export interface LegacyPorts {
  tasks: TaskRuntime;
  target(userId: string, sessionId: string): Promise<LegacyTarget>;
  notify(sessionId: string, taskId: string): void;
}
export class LegacyCommandService {
  constructor(private readonly ports: LegacyPorts) {}
  async create(userId: string, input: LegacyTaskRequest) {
    input = { ...input, source: parseLegacySource(input.source) };
    const target = await this.ports.target(userId, input.sessionId),
      compiled = compileLegacy(input.source, target.host),
      current = await this.ports.target(userId, input.sessionId);
    if (JSON.stringify(current) !== JSON.stringify(target))
      throw Error("STALE_SESSION");
    const task = await this.ports.tasks.create(
      { kind: "human", userId },
      {
        sessionId: input.sessionId,
        requestId: input.requestId,
        title: input.source.title,
        mode: input.mode ?? "collaborative",
        commands: compiled.commands,
        source: "workflow",
      },
    );
    this.ports.notify(input.sessionId, task.id);
    return { task, notes: compiled.notes };
  }
}
