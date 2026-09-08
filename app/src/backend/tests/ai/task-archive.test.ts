import { afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AiTaskCoordinator } from "../../ai/tasks/runner";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import type { ChatChunk } from "../../ai/providers/types";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
it("archives a finished AI run and rejects replay of its old creation request", async () => {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  let rounds = 0;
  const events: string[] = [];
  const ai = new AiTaskCoordinator({
    tasks: f.runtime,
    validate: async () => ({ label: "fixture" }),
    audit: async (_user, type) => {
      events.push(type);
    },
    stream: async function* (): AsyncGenerator<ChatChunk> {
      if (++rounds === 1) {
        yield { type: "text", text: "准备核对任务范围。" };
        return;
      }
      yield {
        type: "tool_call",
        call: {
          id: randomUUID(),
          name: "finish_task",
          arguments: { summary: "本次没有执行远端命令。" },
        },
      };
    },
  });
  const input = {
    sessionId: f.sessionId,
    requestId: randomUUID(),
    goal: "只建立任务记录",
    providerId: 1,
    model: "fixture",
    mode: "automatic" as const,
    maxTurns: 5,
  };
  const created = await ai.create("owner", input);
  await vi.waitFor(() =>
    expect(ai.get("owner", created.run.id).phase).toBe(
      "awaiting-authorization",
    ),
  );
  await f.authorize(created.task.id);
  await vi.waitFor(() =>
    expect(ai.get("owner", created.run.id).phase).toBe("completed"),
  );
  await f.runtime.archive(f.human, created.task.id, () =>
    ai.archiveTask("owner", created.task.id),
  );
  expect(ai.list("owner")).toEqual([]);
  expect(events).toContain("agent.archived");
  await expect(ai.create("owner", input)).rejects.toThrow("AI_TASK_ARCHIVED");
  await expect(
    ai.create("owner", { ...input, goal: "different" }),
  ).rejects.toThrow("REQUEST_CONFLICT");
  expect(f.writes).toEqual(["context"]);
});
