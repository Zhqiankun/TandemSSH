import { afterEach, describe, it, expect, vi } from "vitest";
import { AiTaskCoordinator } from "../../ai/tasks/runner.js";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import { WorkflowLibrary } from "../../collaboration/workflows/library.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import type { WorkflowDefinition } from "../../../types/workflow.js";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types.js";
const human: TaskActor = { kind: "human", userId: "owner" },
  closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});
const tool = (
  name: string,
  args: Record<string, unknown>,
  id = name,
): ChatChunk => ({ type: "tool_call", call: { id, name, arguments: args } });
function reply(request: ChatRequest, name: string) {
  const message = request.messages
    .filter((message) => message.role === "tool" && message.toolName === name)
    .at(-1);
  return message ? JSON.parse(message.content) : undefined;
}
async function setup(
  mode: "automatic" | "collaborative" = "automatic",
  options: { hold?: boolean; failed?: boolean; batch?: boolean } = {},
) {
  const writes: string[] = [],
    requests: ChatRequest[] = [];
  let held = false;
  let release!: (value: {
    exitCode: number | null;
    output: string;
    cwd?: string;
  }) => void;
  const pending = new Promise<{
    exitCode: number | null;
    output: string;
    cwd?: string;
  }>((resolve) => {
    release = resolve;
  });
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: (bytes) => {
        writes.push(Buffer.from(bytes).toString());
      },
    },
    () => {},
  );
  const session = {
    id: "session",
    userId: "owner",
    hostId: 1,
    hostName: "fixture",
    groups: () => [],
    control,
    executor: {
      prepareContext: () => ({
        bytes: Buffer.from("context"),
        completion: Promise.resolve({ exitCode: 0, output: "", cwd: "/srv" }),
        dispose: () => {},
      }),
      prepare: async (action: { program: string; cwd: string }) => {
        const wait = options.hold && !held;
        if (wait) held = true;
        return {
          bytes: Buffer.from(action.program),
          completion: wait
            ? pending
            : Promise.resolve({
                exitCode: action.program === "false" ? 1 : 0,
                output: action.program === "pwd" ? "/srv" : "done",
                cwd: action.cwd,
              }),
          dispose: () => {
            if (wait) release({ exitCode: null, output: "interrupted" });
          },
        };
      },
    },
  };
  const runtime = new TaskRuntime({
    getSession: () => session,
    policy: async () => ({ revision: 1, sets: [] }),
    audit: () => ({ append: async () => {}, record: async () => {} }),
  });
  let store: string | undefined;
  const workflows = new WorkflowLibrary({
    read: () => store,
    write: async (_, text) => {
      store = text;
    },
    ownsHost: async (_, id) => id === 1,
    target: () => ({ hostId: 1, groups: [], control: control.snapshot() }),
    policy: () => ({ revision: 1, sets: [] }),
    tasks: runtime,
    audit: async () => {},
  });
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    id: "check",
    name: "已保存巡检",
    version: "1.0.0",
    parameters: { message: { type: "string", default: "hello" } },
    defaults: { cwd: "/srv" },
    steps: [
      {
        id: "one",
        name: "第一步",
        onFailure: options.failed ? "continue" : "stop",
        action: {
          type: "command",
          program: options.failed ? "false" : "pwd",
          args: [],
        },
      },
      {
        id: "two",
        name: "第二步",
        action: {
          type: "command",
          program: "printf",
          args: ["%s", { param: "message" }],
        },
      },
    ],
  };
  await workflows.save("owner", { definition, allowedHostIds: [1] });
  const coordinator = new AiTaskCoordinator({
    tasks: runtime,
    workflows,
    validate: async () => ({ label: "测试模型" }),
    audit: async () => {},
    stream: async function* (_user, _provider, request) {
      requests.push(request);
      if (requests.length === 1) {
        yield { type: "text", text: "先选择保存的巡检流程，再核对真实结果。" };
        return;
      }
      const list = reply(request, "list_workflows"),
        detail = reply(request, "get_workflow"),
        preview = reply(request, "preview_workflow"),
        run = reply(request, "run_workflow"),
        result = reply(request, "get_workflow_run");
      if (!list) yield tool("list_workflows", {});
      else if (!detail)
        yield tool("get_workflow", { workflowId: list.workflows[0].id });
      else if (!preview)
        yield tool("preview_workflow", {
          workflowId: detail.id,
          parameters: { message: "模型填写的参数" },
        });
      else if (!run) {
        yield tool("run_workflow", { previewId: preview.id });
        if (options.batch)
          yield tool(
            "run_command",
            { program: "printf", args: ["must-wait-for-model-review"] },
            "stale-batch",
          );
      } else if (!result)
        yield tool("get_workflow_run", { workflowRunId: run.id });
      else
        yield tool("finish_task", {
          summary: result.hasFailures
            ? "已结束，保留失败步骤，请检查。"
            : "已核对两个步骤的真实结果。",
        });
    },
  });
  const created = await coordinator.create("owner", {
    sessionId: "session",
    requestId: "ai-run",
    providerId: 1,
    model: "fixture",
    goal: "使用保存流程检查服务器",
    mode,
    maxTurns: 12,
  });
  const authorize = (reconciliation?: "retry" | "skip") =>
    runtime.authorize(human, created.task.id, {
      ...control.snapshot(),
      planRevision: runtime.get(human, created.task.id).planRevision,
      policyRevision: 1,
      shellReady: true,
      directory: "/srv",
      maxOperations: 10,
      durationMinutes: 1,
      allowReviewedPlan: false,
      matches: ["pwd", "printf", "false"].map((program) => ({
        kind: "program" as const,
        program,
      })),
      reconciliation,
    });
  closers.push(() => {
    coordinator.stopAll();
    control.close();
    release({ exitCode: null, output: "closed" });
  });
  return {
    runtime,
    coordinator,
    control,
    writes,
    requests,
    created,
    authorize,
    workflows,
  };
}
describe("built-in AI reuses a saved workflow in its parent task", () => {
  it("discovers, previews and executes a flow before making a fresh model decision", async () => {
    const f = await setup("automatic", { batch: true });
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
        "awaiting-authorization",
      ),
    );
    expect(f.writes).toEqual([]);
    await f.authorize();
    await vi.waitFor(
      () =>
        expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
          "completed",
        ),
      { timeout: 4000 },
    );
    expect(f.writes).toEqual(["context", "pwd", "printf"]);
    const task = f.runtime.get(human, f.created.task.id);
    expect(task.workflowRuns).toHaveLength(1);
    expect(
      task.operations.every(
        (op) => op.workflowRunId === task.workflowRuns![0].id,
      ),
    ).toBe(true);
    expect(
      f.requests
        .at(-1)!
        .messages.some((message) =>
          message.content.includes("WORKFLOW_RESULT_REVIEW_REQUIRED"),
        ),
    ).toBe(true);
    expect(f.requests[1].tools?.map((tool) => tool.name)).toContain(
      "preview_workflow",
    );
  });
  it("waits for each cooperative approval without polling the model", async () => {
    const f = await setup("collaborative");
    const resultRead = vi.spyOn(f.workflows, "result");
    await f.authorize();
    await vi.waitFor(
      () =>
        expect(f.runtime.get(human, f.created.task.id).state).toBe(
          "awaiting-approval",
        ),
      { timeout: 3000 },
    );
    const count = f.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.requests).toHaveLength(count);
    expect(resultRead).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const op = f.runtime.get(human, f.created.task.id).operations.at(-1)!;
      await f.runtime.approve(human, f.created.task.id, op.id, op.digest, 1);
      if (i === 0)
        await vi.waitFor(() =>
          expect(
            f.runtime.get(human, f.created.task.id).operations.at(-1)?.status,
          ).toBe("awaiting-approval"),
        );
    }
    await vi.waitFor(
      () =>
        expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
          "completed",
        ),
      { timeout: 3000 },
    );
    expect(f.writes).toEqual(["context", "pwd", "printf"]);
  });
  it("resumes the existing flow after takeover instead of starting it again", async () => {
    const f = await setup("automatic", { hold: true });
    await f.authorize();
    await vi.waitFor(() => expect(f.writes).toContain("pwd"), {
      timeout: 3000,
    });
    f.control.humanInput(Buffer.from("manual"));
    await vi.waitFor(() =>
      expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
        "paused-human",
      ),
    );
    const count = f.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.requests).toHaveLength(count);
    await f.authorize("skip");
    await vi.waitFor(
      () =>
        expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
          "completed-with-errors",
        ),
      { timeout: 3000 },
    );
    const task = f.runtime.get(human, f.created.task.id);
    expect(task.workflowRuns).toHaveLength(1);
    expect(task.operations[0]).toMatchObject({
      status: "unknown",
      reviewed: { decision: "skip" },
    });
    expect(f.writes.filter((value) => value === "pwd")).toHaveLength(1);
  });
  it("does not label a continued failure as full success", async () => {
    const f = await setup("automatic", { failed: true });
    await f.authorize();
    await vi.waitFor(
      () =>
        expect(f.coordinator.get("owner", f.created.run.id).phase).toBe(
          "completed-with-errors",
        ),
      { timeout: 3000 },
    );
    expect(f.runtime.get(human, f.created.task.id).state).toBe(
      "completed-with-errors",
    );
  });
});
