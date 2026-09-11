import { afterEach, describe, it, expect, vi } from "vitest";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import { WorkflowLibrary } from "../../collaboration/workflows/library.js";
import type {
  TaskAuthorization,
  TaskCommand,
} from "../../../types/collaboration-task.js";
import type { WorkflowDefinition } from "../../../types/workflow.js";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations.js";
const human: TaskActor = { kind: "human", userId: "owner" };
const actor: TaskActor = {
  kind: "mcp",
  userId: "owner",
  clientId: "client",
  connectionId: "connection",
  allowedHostIds: [1],
};
const close: Array<() => void> = [];
afterEach(() => {
  for (const fn of close.splice(0)) fn();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(
  options: {
    holdProgram?: string;
    exitCode?: number;
    outputSize?: number;
    audit?: (type: string) => Promise<void>;
  } = {},
) {
  const writes: string[] = [],
    commands: TaskCommand[] = [],
    store = new Map<string, string>();
  let held = false;
  const heldResult = deferred<{
    exitCode: number | null;
    output: string;
    cwd?: string;
  }>();
  const policy: CommandPolicySnapshot = { revision: 1, sets: [] };
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
  const groups: string[] = [];
  const session = {
    id: "session",
    userId: "owner",
    hostId: 1,
    hostName: "fixture",
    groups: () => groups,
    control,
    executor: {
      prepareContext: () => ({
        bytes: Buffer.from("context"),
        completion: Promise.resolve({ exitCode: 0, output: "", cwd: "/srv" }),
        dispose: () => {},
      }),
      prepare: async (command: TaskCommand) => {
        commands.push(command);
        const wait = !held && command.program === options.holdProgram;
        if (wait) held = true;
        return {
          bytes: Buffer.from(command.program),
          completion: wait
            ? heldResult.promise
            : Promise.resolve({
                exitCode:
                  command.program === "false" ? (options.exitCode ?? 1) : 0,
                output: options.outputSize
                  ? "x".repeat(options.outputSize)
                  : command.program,
                cwd: command.cwd,
              }),
          dispose: () => {
            if (wait)
              heldResult.resolve({ exitCode: null, output: "interrupted" });
          },
        };
      },
    },
  };
  const runtime = new TaskRuntime({
    getSession: () => session,
    policy: async () => policy,
    audit: () => ({
      append: async () => {},
      record: async (type) => {
        await options.audit?.(type);
      },
    }),
  });
  runtime.connectClient("connection");
  const library = new WorkflowLibrary({
    read: (user) => store.get(user),
    write: async (user, value) => {
      store.set(user, value);
    },
    ownsHost: async (user, id) => user === "owner" && [1, 2].includes(id),
    target: () => ({ hostId: 1, groups, control: control.snapshot() }),
    policy: () => policy,
    audit: async () => {},
    tasks: runtime,
  });
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    id: "check",
    name: "检查流程",
    version: "1.0.0",
    parameters: { text: { type: "string", default: "hello" } },
    defaults: { cwd: "/srv" },
    steps: [
      {
        id: "one",
        name: "目录",
        action: { type: "command", program: "pwd", args: [] },
      },
      {
        id: "two",
        name: "输出",
        action: {
          type: "command",
          program: "printf",
          args: ["%s", { param: "text" }],
        },
      },
    ],
  };
  const create = (mode: "automatic" | "collaborative" = "automatic") =>
    runtime.create(actor, {
      sessionId: "session",
      requestId: "parent",
      title: "部署父任务",
      mode,
    });
  const authorize = (id: string, extra: Partial<TaskAuthorization> = {}) =>
    runtime.authorize(human, id, {
      ...control.snapshot(),
      planRevision: runtime.get(human, id).planRevision,
      shellReady: true,
      policyRevision: policy.revision,
      maxOperations: 10,
      durationMinutes: 1,
      directory: "/srv",
      matches: ["pwd", "printf", "false", "bash"].map((program) => ({
        kind: "program" as const,
        program,
      })),
      allowReviewedPlan: false,
      ...extra,
    });
  const saved = (value = definition, hosts = [1]) =>
    library.save("owner", { definition: value, allowedHostIds: hosts });
  const preview = (id: string, parentTaskId: string) =>
    library.preview(actor, {
      workflowId: id,
      sessionId: "session",
      parentTaskId,
      parameters: {},
    });
  close.push(() => {
    control.close();
    heldResult.resolve({ exitCode: null, output: "closed" });
  });
  return {
    runtime,
    library,
    control,
    policy,
    groups,
    writes,
    commands,
    heldResult,
    definition,
    create,
    authorize,
    saved,
    preview,
  };
}
describe("workflows inherit an external parent task", () => {
  it("retains the lease, shares the budget, and isolates repeated flow request IDs", async () => {
    const f = fixture(),
      saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id, { maxOperations: 4 });
    const lease = f.control.snapshot();
    for (let i = 0; i < 2; i++) {
      const preview = f.preview(saved.id, task.id);
      const run = await f.library.run(actor, task.id, preview.id, "run" + i);
      await vi.waitFor(() =>
        expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
          "completed",
        ),
      );
      expect(f.control.snapshot()).toEqual(lease);
    }
    expect(f.writes).toEqual(["context", "pwd", "printf", "pwd", "printf"]);
    expect(f.runtime.get(actor, task.id).workflowRuns).toHaveLength(2);
    expect(
      (
        await f.runtime.create(actor, {
          sessionId: "session",
          requestId: "parent",
          title: "部署父任务",
          mode: "automatic",
        })
      ).id,
    ).toBe(task.id);
    await f.runtime.submit(
      actor,
      task.id,
      { program: "pwd", args: [] },
      "over-budget",
    );
    await vi.waitFor(() =>
      expect(f.runtime.get(actor, task.id).error).toBe("TASK_BUDGET_EXCEEDED"),
    );
    expect(f.commands).toHaveLength(4);
  });
  it("serializes cooperative steps and refuses side commands while the flow is active", async () => {
    const f = fixture(),
      saved = await f.saved(),
      task = await f.create("collaborative");
    await f.authorize(task.id);
    const preview = f.preview(saved.id, task.id),
      run = await f.library.run(actor, task.id, preview.id, "flow");
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() =>
        expect(f.runtime.get(actor, task.id).state).toBe("awaiting-approval"),
      );
      await expect(
        f.runtime.submit(
          actor,
          task.id,
          { program: "pwd", args: [] },
          "side" + i,
        ),
      ).rejects.toThrow("WORKFLOW_PLAN_IMMUTABLE");
      const op = f.runtime.get(actor, task.id).operations.at(-1)!;
      await f.runtime.approve(human, task.id, op.id, op.digest, 1);
    }
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed",
      ),
    );
    expect(f.runtime.get(actor, task.id).state).toBe("ready");
    expect(f.control.snapshot().controller.kind).toBe("automation");
    expect(f.writes).toEqual(["context", "pwd", "printf"]);
  });
  it("requires a fresh plan revision before the initial human authorization", async () => {
    const f = fixture(),
      saved = await f.saved(),
      task = await f.create();
    const preview = f.preview(saved.id, task.id);
    const run = await f.library.run(actor, task.id, preview.id, "initial");
    expect(f.writes).toEqual([]);
    await expect(f.authorize(task.id, { planRevision: 0 })).rejects.toThrow(
      "STALE_PLAN",
    );
    expect(f.writes).toEqual([]);
    await f.authorize(task.id);
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed",
      ),
    );
  });
  it("cannot borrow an old reviewed-plan grant for a newly attached script", async () => {
    const f = fixture();
    f.definition.steps = [
      {
        id: "script",
        name: "脚本",
        action: { type: "script", shell: "bash", source: "printf reviewed" },
      },
    ];
    const saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id, { allowReviewedPlan: true });
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "script",
    );
    await vi.waitFor(() =>
      expect(f.runtime.get(actor, task.id).state).toBe("awaiting-approval"),
    );
    expect(f.writes).toEqual(["context"]);
    const op = f.runtime.get(actor, task.id).operations[0];
    await f.runtime.approve(human, task.id, op.id, op.digest, 1);
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed",
      ),
    );
  });
  it("preserves unknown results after takeover and only resumes after human reconciliation", async () => {
    const f = fixture({ holdProgram: "pwd" }),
      saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "interrupted",
    );
    await vi.waitFor(() => expect(f.writes).toContain("pwd"));
    f.control.humanInput(Buffer.from("manual"));
    await vi.waitFor(() =>
      expect(f.runtime.get(actor, task.id).operations[0].status).toBe(
        "unknown",
      ),
    );
    expect(f.commands).toHaveLength(1);
    await expect(f.authorize(task.id)).rejects.toThrow(
      "RECONCILIATION_REQUIRED",
    );
    await f.authorize(task.id, { reconciliation: "skip" });
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed-with-errors",
      ),
    );
    expect(f.runtime.get(actor, task.id).operations[0]).toMatchObject({
      status: "unknown",
      reviewed: { decision: "skip" },
    });
    expect((await f.runtime.finish(actor, task.id)).state).toBe(
      "completed-with-errors",
    );
    expect(f.writes.filter((x) => x === "pwd")).toHaveLength(1);
  });
  it("keeps known continue-on-failure results visible without making the parent successful", async () => {
    const f = fixture();
    f.definition.steps[0].action = {
      type: "command",
      program: "false",
      args: [],
    };
    f.definition.steps[0].onFailure = "continue";
    const saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "continue",
    );
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed-with-errors",
      ),
    );
    expect((await f.runtime.finish(actor, task.id)).state).toBe(
      "completed-with-errors",
    );
    expect(
      f.runtime.get(actor, task.id).operations.map((op) => op.exitCode),
    ).toEqual([1, 0]);
  });
  it("does not attach a stale flow after a delayed audit and human takeover", async () => {
    const audit = deferred<void>(),
      entered = deferred<void>();
    const f = fixture({
        audit: async (type) => {
          if (type === "workflow.attached") {
            entered.resolve();
            await audit.promise;
          }
        },
      }),
      saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const pending = f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "race",
    );
    await entered.promise;
    f.control.takeover();
    audit.resolve();
    await expect(pending).rejects.toThrow("STALE_CONTROL");
    expect(f.runtime.get(actor, task.id).workflowRuns).toEqual([]);
    expect(f.commands).toEqual([]);
  });
  it("deduplicates a started preview and rejects mismatched parents, principals and policies", async () => {
    const f = fixture({ holdProgram: "pwd" }),
      saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const preview = f.preview(saved.id, task.id);
    await expect(
      f.library.run(
        { ...actor, kind: "mcp", clientId: "other" },
        task.id,
        preview.id,
        "wrong",
      ),
    ).rejects.toThrow("WORKFLOW_PREVIEW_NOT_FOUND");
    await expect(
      f.library.start(actor, preview.id, "wrong", "automatic"),
    ).rejects.toThrow("WORKFLOW_PARENT_MISMATCH");
    const run = await f.library.run(actor, task.id, preview.id, "one");
    expect((await f.library.run(actor, task.id, preview.id, "one")).id).toBe(
      run.id,
    );
    await expect(
      f.library.run(actor, task.id, preview.id, "two"),
    ).rejects.toThrow("WORKFLOW_PREVIEW_USED");
    expect(() =>
      f.runtime.workflowRun(
        { ...actor, kind: "mcp", clientId: "other" },
        task.id,
        run.id,
      ),
    ).toThrow("TASK_NOT_FOUND");
  });
  it("bounds flow output across all steps, including the zero remaining budget case", async () => {
    const f = fixture({ outputSize: 5000 });
    f.definition.steps = Array.from({ length: 6 }, (_, i) => ({
      id: "s" + i,
      name: "步骤",
      action: { type: "command" as const, program: "printf", args: ["x"] },
    }));
    const saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "output",
    );
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed",
      ),
    );
    const result = f.library.result(actor, task.id, run.id);
    expect(
      result.operations.reduce((sum, op) => sum + (op.output?.length ?? 0), 0),
    ).toBeLessThanOrEqual(12000);
    expect(result.operations[0]).toMatchObject({
      output: undefined,
      outputTruncated: true,
    });
  });
  it("filters the catalog by owned host scope and does not return executable source", async () => {
    const f = fixture();
    await f.saved();
    await f.saved({ ...f.definition, name: "host 2" }, [2]);
    const result = await f.library.catalog(actor, 1);
    expect(result.workflows.map((row) => row.name)).toEqual(["检查流程"]);
    expect(result.workflows[0]).not.toHaveProperty("parameters");
    await expect(f.library.catalog(actor, 2)).rejects.toThrow("HOST_NOT_FOUND");
    const detail = await f.library.detail(actor, 1, result.workflows[0].id);
    expect(detail.parameters).toHaveProperty("text");
    expect(detail.steps[0]).not.toHaveProperty("args");
  });
});

describe("workflow preflight and effective host scope", () => {
  it("rejects known deny matches before any flow command is dispatched", async () => {
    const f = fixture();
    f.policy.sets = [
      {
        id: "deny",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: [
          {
            id: "printf",
            effect: "deny",
            match: { kind: "program", program: "printf" },
            reason: "blocked",
          },
        ],
      },
    ];
    const saved = await f.saved(),
      task = await f.create();
    await f.authorize(task.id);
    const preview = f.preview(saved.id, task.id);
    expect(() => f.library.run(actor, task.id, preview.id, "denied")).toThrow(
      "POLICY_DENIED",
    );
    expect(f.commands).toEqual([]);
  });
  it("does not carry an old grant into changed group membership", async () => {
    const f = fixture(),
      task = await f.create();
    await f.authorize(task.id);
    f.groups.push("production");
    await f.runtime.submit(
      actor,
      task.id,
      { program: "pwd", args: [] },
      "changed",
    );
    await vi.waitFor(() =>
      expect(f.runtime.get(actor, task.id).error).toBe("HOST_SCOPE_CHANGED"),
    );
    expect(f.commands).toEqual([]);
  });
});

describe("authorization group change races", () => {
  it("does not send even the context probe when group membership changed during audit", async () => {
    const gate = deferred<void>(),
      entered = deferred<void>();
    const f = fixture({
        audit: async (type) => {
          if (type === "task.authorization") {
            entered.resolve();
            await gate.promise;
          }
        },
      }),
      task = await f.create();
    const grant = f.authorize(task.id);
    await entered.promise;
    f.groups.push("changed");
    gate.resolve();
    await expect(grant).rejects.toThrow("HOST_SCOPE_CHANGED");
    expect(f.writes).toEqual([]);
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
});

it.each(["automatic", "collaborative"] as const)(
  "stops before step three after step two fails in %s mode",
  async (mode) => {
    const f = fixture();
    f.definition.steps[1].action = {
      type: "command",
      program: "false",
      args: [],
    };
    f.definition.steps.push({
      id: "three",
      name: "不得执行",
      action: { type: "command", program: "printf", args: ["must-not-run"] },
    });
    const saved = await f.saved(),
      task = await f.create(mode);
    await f.authorize(task.id);
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "second-step-fails",
    );
    if (mode === "collaborative") {
      for (let i = 0; i < 2; i++) {
        await vi.waitFor(() => {
          const view = f.runtime.get(actor, task.id);
          expect(view.state).toBe("awaiting-approval");
          expect(view.operations).toHaveLength(i + 1);
        });
        const op = f.runtime.get(actor, task.id).operations[i];
        await f.runtime.approve(human, task.id, op.id, op.digest, 1);
      }
    }
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "paused-error",
      ),
    );
    const view = f.runtime.get(actor, task.id);
    expect(view.operations).toHaveLength(2);
    expect(view.operations[1]).toMatchObject({ status: "failed", exitCode: 1 });
    expect(f.runtime.workflowRun(actor, task.id, run.id).error).toBeTruthy();
    expect(f.commands.map((c) => c.program)).toEqual(["pwd", "false"]);
    expect(f.writes.filter((value) => value !== "context")).toEqual([
      "pwd",
      "false",
    ]);
  },
);
it("keeps the running workflow snapshot and uses an edit only on its next run", async () => {
  const f = fixture({ holdProgram: "pwd" });
  const saved = await f.saved(),
    task = await f.create();
  await f.authorize(task.id);
  const first = await f.library.run(
    actor,
    task.id,
    f.preview(saved.id, task.id).id,
    "first-snapshot",
  );
  await vi.waitFor(() => expect(f.writes).toContain("pwd"));
  const changed = structuredClone(f.definition);
  changed.version = "2.0.0";
  changed.steps[1].action = {
    type: "command",
    program: "printf",
    args: ["new-version"],
  };
  const updated = await f.library.save("owner", {
    id: saved.id,
    expectedRevision: saved.revision,
    definition: changed,
    allowedHostIds: [1],
  });
  f.heldResult.resolve({ exitCode: 0, output: "/srv", cwd: "/srv" });
  await vi.waitFor(() =>
    expect(f.runtime.workflowRun(actor, task.id, first.id).state).toBe(
      "completed",
    ),
  );
  expect(f.commands[1].args).toEqual(["%s", "hello"]);
  expect(
    f.runtime.workflowRun(actor, task.id, first.id).workflow.revision,
  ).toBe(saved.revision);
  const second = await f.library.run(
    actor,
    task.id,
    f.preview(saved.id, task.id).id,
    "next-snapshot",
  );
  await vi.waitFor(() =>
    expect(f.runtime.workflowRun(actor, task.id, second.id).state).toBe(
      "completed",
    ),
  );
  expect(f.commands[3].args).toEqual(["new-version"]);
  expect(
    f.runtime.workflowRun(actor, task.id, second.id).workflow.revision,
  ).toBe(updated.revision);
});

it.each(["automatic", "collaborative"] as const)(
  "resumes after the interrupted second step without replaying step one in %s mode",
  async (mode) => {
    const f = fixture({ holdProgram: "printf" });
    f.definition.steps.push({
      id: "three",
      name: "最后一步",
      action: { type: "command", program: "pwd", args: ["-L"] },
    });
    const saved = await f.saved(),
      task = await f.create(mode);
    await f.authorize(task.id);
    const run = await f.library.run(
      actor,
      task.id,
      f.preview(saved.id, task.id).id,
      "second-step-takeover",
    );
    if (mode === "collaborative") {
      for (let i = 0; i < 2; i++) {
        await vi.waitFor(() => {
          const view = f.runtime.get(actor, task.id);
          expect(view.state).toBe("awaiting-approval");
          expect(view.operations).toHaveLength(i + 1);
        });
        const op = f.runtime.get(actor, task.id).operations[i];
        await f.runtime.approve(human, task.id, op.id, op.digest, 1);
      }
    }
    await vi.waitFor(() => expect(f.writes).toContain("printf"));
    const previous = f.runtime.get(actor, task.id).operations[1];
    f.control.humanInput(Buffer.from("manual"));
    await vi.waitFor(() =>
      expect(f.runtime.get(actor, task.id).operations[1].status).toBe(
        "unknown",
      ),
    );
    expect(f.commands.map((c) => c.args)).toEqual([[], ["%s", "hello"]]);
    await expect(f.authorize(task.id)).rejects.toThrow(
      "RECONCILIATION_REQUIRED",
    );
    await expect(
      f.runtime.approve(human, task.id, previous.id, previous.digest, 1),
    ).rejects.toThrow();
    await f.authorize(task.id, { reconciliation: "skip" });
    if (mode === "collaborative") {
      await vi.waitFor(() => {
        const view = f.runtime.get(actor, task.id);
        expect(view.state).toBe("awaiting-approval");
        expect(view.operations).toHaveLength(3);
      });
      const third = f.runtime.get(actor, task.id).operations[2],
        before = [...f.writes];
      await expect(
        f.runtime.approve(human, task.id, third.id, previous.digest, 1),
      ).rejects.toThrow();
      expect(f.writes).toEqual(before);
      await f.runtime.approve(human, task.id, third.id, third.digest, 1);
    }
    await vi.waitFor(() =>
      expect(f.runtime.workflowRun(actor, task.id, run.id).state).toBe(
        "completed-with-errors",
      ),
    );
    const operations = f.runtime.get(actor, task.id).operations;
    expect(operations.map((op) => op.status)).toEqual([
      "succeeded",
      "unknown",
      "succeeded",
    ]);
    expect(operations[1]).toMatchObject({ reviewed: { decision: "skip" } });
    expect(
      f.commands.map((c) => ({ program: c.program, args: c.args })),
    ).toEqual([
      { program: "pwd", args: [] },
      { program: "printf", args: ["%s", "hello"] },
      { program: "pwd", args: ["-L"] },
    ]);
  },
);
