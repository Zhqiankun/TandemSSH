import { afterEach, expect, it, vi } from "vitest";
import { AiTaskCoordinator } from "../../ai/tasks/runner.js";
import {
  TaskRuntime,
  type TaskSession,
} from "../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types.js";
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
});
it.each(["automatic", "collaborative"] as const)(
  "%s concurrent AI tasks keep delayed commands and terminal context in their original sessions",
  async (mode) => {
    const writes = { a: [] as string[], b: [] as string[] };
    const sessions = new Map<string, TaskSession>();
    for (const [index, id] of ["a", "b"].entries()) {
      const control = new SessionControl(
        id,
        {
          isReady: () => true,
          write: (data) =>
            writes[id as "a" | "b"].push(Buffer.from(data).toString()),
        },
        () => {},
      );
      sessions.set(id, {
        id,
        userId: "owner",
        hostId: index + 1,
        hostName: "host-" + id,
        groups: () => [],
        control,
        readOutput: () => ({
          text: "output-only-" + id,
          generation: control.snapshot().generation,
          cursor: 1,
          truncated: false,
        }),
        executor: {
          prepareContext: () => ({
            bytes: Buffer.from("context"),
            completion: Promise.resolve({
              exitCode: 0,
              output: "",
              cwd: "/srv/" + id,
            }),
            dispose: () => {},
          }),
          prepare: async (command) => ({
            bytes: Buffer.from(command.program + " " + command.args.join(" ")),
            completion: Promise.resolve({
              exitCode: 0,
              output: "result-only-" + id,
              cwd: command.cwd,
            }),
            dispose: () => {},
          }),
        },
      });
      closers.push(() => control.close());
    }
    const runtime = new TaskRuntime({
      getSession: (id) => sessions.get(id) ?? null,
      policy: async () => ({ revision: 1, sets: [] }),
      audit: () => ({ append: async () => {}, record: async () => {} }),
    });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    const requests = { a: [] as ChatRequest[], b: [] as ChatRequest[] };
    const coordinator = new AiTaskCoordinator({
      tasks: runtime,
      validate: async () => ({ label: "多会话模型夹具" }),
      audit: async () => {},
      stream: async function* (
        _user,
        _provider,
        request,
      ): AsyncIterable<ChatChunk> {
        const id = request.messages[0].content === "task-a" ? "a" : "b";
        requests[id].push(request);
        const index = requests[id].length;
        if (index === 1) {
          yield { type: "text", text: "检查原会话" };
          return;
        }
        if (index === 2) {
          if (id === "a") {
            entered();
            await held;
          }
          yield {
            type: "tool_call",
            call: {
              id: "command-" + id,
              name: "run_command",
              arguments: { program: "printf", args: ["marker-" + id] },
            },
          };
        } else
          yield {
            type: "tool_call",
            call: {
              id: "finish-" + id,
              name: "finish_task",
              arguments: { summary: "原会话操作完成" },
            },
          };
      },
    });
    closers.push(() => {
      release();
      coordinator.stopAll();
    });
    const human = { kind: "human" as const, userId: "owner" };
    const start = async (id: "a" | "b") => {
      const created = await coordinator.create("owner", {
        sessionId: id,
        requestId: id,
        providerId: 1,
        model: "fixture",
        goal: "task-" + id,
        mode,
        maxTurns: 4,
      });
      await runtime.authorize(human, created.task.id, {
        ...sessions.get(id)!.control.snapshot(),
        shellReady: true,
        policyRevision: 1,
        maxOperations: 2,
        durationMinutes: 1,
        allowReviewedPlan: false,
        matches: [{ kind: "program", program: "printf" }],
      });
      return created;
    };
    const finish = async (created: Awaited<ReturnType<typeof start>>) => {
      if (mode === "collaborative") {
        await vi.waitFor(() =>
          expect(runtime.get(human, created.task.id).state).toBe(
            "awaiting-approval",
          ),
        );
        const op = runtime.get(human, created.task.id).operations[0];
        await runtime.approve(human, created.task.id, op.id, op.digest, 1);
      }
      await vi.waitFor(() =>
        expect(coordinator.get("owner", created.run.id).phase).toBe(
          "completed",
        ),
      );
    };
    const a = await start("a");
    await waiting;
    const b = await start("b");
    await finish(b);
    expect(writes.a).toEqual(["context"]);
    expect(writes.b).toEqual(["context", "printf marker-b"]);
    release();
    await finish(a);
    expect(writes.a).toEqual(["context", "printf marker-a"]);
    expect(writes.b).toEqual(["context", "printf marker-b"]);
    for (const [id, other, created] of [
      ["a", "b", a],
      ["b", "a", b],
    ] as const) {
      const request = requests[id][1];
      expect(request.system).toContain('"target":"host-' + id + '"');
      expect(JSON.stringify(request.messages)).toContain("output-only-" + id);
      expect(JSON.stringify(requests[id])).not.toContain(
        "output-only-" + other,
      );
      expect(JSON.stringify(requests[id])).not.toContain(
        "result-only-" + other,
      );
      const task = runtime.get(human, created.task.id);
      expect(task.sessionId).toBe(id);
      expect(task.operations[0].action.cwd).toBe("/srv/" + id);
      expect(task.operations[0].output).toBe("result-only-" + id);
    }
  },
);
