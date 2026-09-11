import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTaskCoordinator } from "../../ai/tasks/runner.js";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types.js";
const user: TaskActor = { kind: "human", userId: "owner" };
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const call = (
  name: string,
  args: Record<string, unknown>,
  id = "call",
): ChatChunk => ({ type: "tool_call", call: { id, name, arguments: args } });
function fixture(
  stream: (request: ChatRequest, index: number) => AsyncIterable<ChatChunk>,
  hold = false,
) {
  const requests: ChatRequest[] = [],
    writes: string[] = [];
  const completion = deferred<{
    exitCode: number | null;
    output: string;
    cwd?: string;
  }>();
  let cwd = "/srv";
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: (bytes) => {
        const text = Buffer.from(bytes).toString();
        writes.push(text);
        if (text === "manual") cwd = "/srv/manual";
      },
    },
    () => {},
  );
  const runtime = new TaskRuntime({
    getSession: () => ({
      id: "session",
      userId: "owner",
      hostId: 1,
      hostName: "fixture",
      groups: () => [],
      control,
      executor: {
        prepareContext: () => ({
          bytes: Buffer.from("context"),
          completion: Promise.resolve({ exitCode: 0, output: "", cwd }),
          dispose: () => {},
        }),
        prepare: async (command) => ({
          bytes: Buffer.from(command.program + " " + command.args.join(" ")),
          completion: hold
            ? completion.promise
            : Promise.resolve({
                exitCode: 0,
                output: command.program === "pwd" ? command.cwd : "ok",
                cwd: command.cwd,
              }),
          dispose: () => {
            if (hold)
              completion.resolve({ exitCode: null, output: "uncertain" });
          },
        }),
      },
    }),
    policy: async () => ({ revision: 1, sets: [] }),
    audit: () => ({ append: async () => {}, record: async () => {} }),
  });
  const coordinator = new AiTaskCoordinator({
    tasks: runtime,
    validate: async () => ({ label: "本机模型" }),
    stream: (_user, _provider, request) => {
      requests.push(request);
      return stream(request, requests.length);
    },
    audit: async () => {},
  });
  const start = async (
    mode: "automatic" | "collaborative" = "automatic",
    maxTurns = 10,
  ) =>
    coordinator.create("owner", {
      sessionId: "session",
      requestId: "run",
      providerId: 1,
      model: "test-model",
      goal: "检查目录并报告",
      mode,
      maxTurns,
    });
  const authorize = (taskId: string, reconciliation?: "retry" | "skip") =>
    runtime.authorize(user, taskId, {
      ...control.snapshot(),
      shellReady: true,
      policyRevision: 1,
      maxOperations: 10,
      durationMinutes: 1,
      allowReviewedPlan: false,
      matches: [
        { kind: "program", program: "pwd" },
        { kind: "program", program: "printf" },
      ],
      reconciliation,
    });
  closers.push(() => {
    coordinator.stopAll();
    control.close();
    completion.resolve({ exitCode: null, output: "closed" });
  });
  return {
    runtime,
    coordinator,
    control,
    requests,
    writes,
    completion,
    start,
    authorize,
  };
}
async function* normal(_request: ChatRequest, index: number) {
  if (index === 1)
    yield { type: "text", text: "先读取目录，再验证结果。" } as ChatChunk;
  else if (index === 2) yield call("run_command", { program: "pwd", args: [] });
  else yield call("finish_task", { summary: "已根据实际结果完成目录检查。" });
}
describe("shared-session AI orchestration", () => {
  it("generic task cancellation prevents a model request after delayed validation", async () => {
    const f = fixture(normal);
    const entered = deferred<void>(),
      release = deferred<void>();
    let validations = 0;
    const stream = vi.fn(async function* () {
      yield { type: "text", text: "should not run" } as ChatChunk;
    });
    const coordinator = new AiTaskCoordinator({
      tasks: f.runtime,
      validate: async () => {
        validations++;
        if (validations === 2) {
          entered.resolve();
          await release.promise;
        }
        return { label: "model" };
      },
      stream,
      audit: async () => {},
    });
    closers.push(() => coordinator.stopAll());
    const created = await coordinator.create("owner", {
      sessionId: "session",
      requestId: "cancel-race",
      providerId: 1,
      model: "test",
      goal: "check",
      mode: "automatic",
      maxTurns: 5,
    });
    await entered.promise;
    f.runtime.cancel(user, created.task.id);
    release.resolve();
    await vi.waitFor(() =>
      expect(coordinator.get("owner", created.run.id).phase).toBe("cancelled"),
    );
    expect(stream).not.toHaveBeenCalled();
  });
  it("pauses rather than silently dropping executed history when context is full", async () => {
    const f = fixture(async function* (_request, index) {
      if (index === 1) yield { type: "text", text: "计划" };
      else {
        yield { type: "text", text: "x".repeat(15000) };
        yield call(
          "run_command",
          { program: "pwd", args: [] },
          "context-" + index,
        );
      }
    });
    const created = await f.start("automatic", 20);
    await f.authorize(created.task.id);
    await vi.waitFor(
      () =>
        expect(f.runtime.get(user, created.task.id).error).toBe(
          "MODEL_CONTEXT_LIMIT",
        ),
      { timeout: 5000 },
    );
    expect(f.requests.length).toBeLessThan(8);
    expect(
      f.runtime.get(user, created.task.id).operations.length,
    ).toBeGreaterThan(1);
  });

  it("plans without executing, then automatically uses the task gateway and real results", async () => {
    const f = fixture(normal),
      created = await f.start();
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "awaiting-authorization",
      ),
    );
    expect(f.writes).toEqual([]);
    expect(f.requests).toHaveLength(1);
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed",
      ),
    );
    expect(f.writes).toEqual(["context", "pwd "]);
    expect(
      f.requests[2].messages.some(
        (message) =>
          message.role === "tool" && message.content.includes("/srv"),
      ),
    ).toBe(true);
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
  it("does not call the model again while waiting for a cooperative approval", async () => {
    const f = fixture(normal),
      created = await f.start("collaborative");
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.runtime.get(user, created.task.id).state).toBe(
        "awaiting-approval",
      ),
    );
    expect(f.writes).toEqual(["context"]);
    expect(f.requests).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(f.requests).toHaveLength(2);
    const op = f.runtime.get(user, created.task.id).operations[0];
    await f.runtime.approve(user, created.task.id, op.id, op.digest, 1);
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed",
      ),
    );
  });
  it("cannot use an agent identity to grant control or inspect another agent's task", async () => {
    const f = fixture(normal),
      created = await f.start();
    const actor: TaskActor = {
      kind: "agent",
      userId: "owner",
      agentRunId: created.run.id,
    };
    await expect(
      f.runtime.authorize(actor, created.task.id, {} as never),
    ).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
    expect(() =>
      f.runtime.get({ ...actor, agentRunId: "other" }, created.task.id),
    ).toThrow("TASK_NOT_FOUND");
  });
  it("discards a late model tool call after takeover and a quick handback", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const f = fixture(async function* (request, index) {
      if (index === 1) yield { type: "text", text: "计划" };
      else if (index === 2) {
        entered.resolve();
        await release.promise;
        yield call("run_command", { program: "printf", args: ["stale"] });
      } else if (index === 3)
        yield call("run_command", { program: "pwd", args: [] });
      else yield call("finish_task", { summary: "已使用更新后的上下文" });
    });
    const created = await f.start();
    await f.authorize(created.task.id);
    await entered.promise;
    f.control.humanInput(Buffer.from("manual"));
    await f.authorize(created.task.id);
    release.resolve();
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed",
      ),
    );
    expect(f.writes).not.toContain("printf stale");
    expect(f.writes.filter((value) => value === "context")).toHaveLength(2);
    expect(f.requests[2].system).toContain('"cwd":"/srv/manual"');
    expect(
      f.requests[2].messages.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("人工已介入并重新授权"),
      ),
    ).toBe(true);
    expect(f.runtime.get(user, created.task.id).operations[0].action.cwd).toBe(
      "/srv/manual",
    );
    expect(
      f.coordinator
        .get("owner", created.run.id)
        .messages.some((message) => message.status === "interrupted"),
    ).toBe(true);
  });
  it("pauses on an unknown command result and requires explicit human reconciliation", async () => {
    const f = fixture(normal, true),
      created = await f.start();
    await f.authorize(created.task.id);
    await vi.waitFor(() => expect(f.writes).toContain("pwd "));
    f.control.takeover();
    await vi.waitFor(() =>
      expect(f.runtime.get(user, created.task.id).operations[0].status).toBe(
        "unknown",
      ),
    );
    await expect(f.authorize(created.task.id)).rejects.toThrow(
      "RECONCILIATION_REQUIRED",
    );
    await f.authorize(created.task.id, "skip");
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed-with-errors",
      ),
    );
    expect(f.runtime.get(user, created.task.id).operations[0]).toMatchObject({
      status: "unknown",
      reviewed: { decision: "skip" },
    });
    expect(f.writes.filter((value) => value === "pwd ")).toHaveLength(1);
  });
  it("waits for an answer without model polling and feeds only the matching answer back", async () => {
    const f = fixture(async function* (_request, index) {
      if (index === 1) yield { type: "text", text: "先确认信息" };
      else if (index === 2)
        yield call("ask_user", { question: "要检查哪个目录？" });
      else if (index === 3)
        yield call("run_command", { program: "pwd", args: [] });
      else yield call("finish_task", { summary: "完成" });
    });
    const created = await f.start();
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "awaiting-answer",
      ),
    );
    const question = f.coordinator.get("owner", created.run.id).question!;
    expect(() =>
      f.coordinator.reply("owner", created.run.id, "stale", "wrong"),
    ).toThrow("STALE_QUESTION");
    expect(f.requests).toHaveLength(2);
    f.coordinator.reply("owner", created.run.id, question.id, "当前目录");
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed",
      ),
    );
    expect(
      f.requests[2].messages.some((message) =>
        message.content.includes("当前目录"),
      ),
    ).toBe(true);
  });
  it("holds at a model budget until a human raises it and reauthorizes", async () => {
    const f = fixture(normal),
      created = await f.start("automatic", 2);
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.runtime.get(user, created.task.id).error).toBe(
        "MODEL_BUDGET_EXCEEDED",
      ),
    );
    expect(f.requests).toHaveLength(2);
    f.coordinator.extendBudget("owner", created.run.id, 4);
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).phase).toBe(
        "completed",
      ),
    );
  });
});

it.each(["automatic", "collaborative"] as const)(
  "keeps manual control and rejects pending model tools after response overflow in %s mode",
  async (mode) => {
    const f = fixture(async function* (_request, index) {
      if (index === 1) {
        yield { type: "text", text: "计划" };
        return;
      }
      yield call("run_command", { program: "printf", args: ["must-not-run"] });
      throw Error("MODEL_RESPONSE_TOO_LARGE");
    });
    const created = await f.start(mode);
    await f.authorize(created.task.id);
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", created.run.id).error).toBe(
        "MODEL_RESPONSE_TOO_LARGE",
      ),
    );
    expect(f.runtime.state(user, created.task.id).state).toBe("paused-error");
    expect(f.writes.some((text) => text.includes("must-not-run"))).toBe(false);
    f.control.humanInput(Buffer.from("manual"));
    expect(f.writes.at(-1)).toBe("manual");
  },
);
