import type { FileExecutorPort } from "../../collaboration/operations/gateway.js";
import { HostFileFence } from "../../collaboration/sessions/host-file-fence.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import type {
  PreparedCommand,
  OperationAuditPort,
} from "../../collaboration/operations/gateway.js";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations.js";
import type {
  TaskAuthorization,
  TaskCommand,
  TaskView,
} from "../../../types/collaboration-task.js";
const human: TaskActor = { kind: "human", userId: "user-a" };
const mcp: TaskActor = {
  kind: "mcp",
  userId: "user-a",
  clientId: "codex",
  connectionId: "connection-1",
  allowedHostIds: [1],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(
  options: {
    audit?: OperationAuditPort & {
      record(type: string, data: unknown): Promise<void>;
    };
    hold?: boolean;
    operationOutput?: string;
    contextResult?: Awaited<PreparedCommand["completion"]>;
    assertAvailable?: () => void;
    files?: FileExecutorPort;
    policy?: CommandPolicySnapshot;
  } = {},
) {
  const writes: string[] = [];
  const commands: TaskCommand[] = [];
  let connected = true;
  const completion = deferred<{
    exitCode: number | null;
    output: string;
    cwd?: string;
  }>();
  const control = new SessionControl(
    "session",
    {
      isReady: () => connected,
      write: (data) => {
        writes.push(Buffer.from(data).toString());
      },
    },
    () => {},
  );
  const policy = options.policy ?? { revision: 1, sets: [] };
  const session = {
    id: "session",
    userId: "user-a",
    hostId: 1,
    hostName: "user@server:22",
    groups: () => [],
    assertAvailable: options.assertAvailable,
    files: options.files,
    control,
    executor: {
      prepareContext: (): PreparedCommand => ({
        bytes: Buffer.from("context"),
        completion: Promise.resolve(
          options.contextResult ?? {
            exitCode: 0,
            output: "",
            cwd: "/srv/app",
          },
        ),
        dispose: () => {},
      }),
      prepare: async (action: TaskCommand): Promise<PreparedCommand> => {
        commands.push(action);
        return {
          bytes: Buffer.from(action.program),
          completion:
            options.hold && commands.length === 1
              ? completion.promise
              : Promise.resolve({
                  exitCode: 0,
                  output: options.operationOutput ?? action.program + " output",
                  cwd: action.program === "cd" ? "/srv/app/child" : action.cwd,
                }),
          dispose: () => {
            if (options.hold)
              completion.resolve({ exitCode: null, output: "interrupted" });
          },
        };
      },
    },
  };
  const runtime = new TaskRuntime({
    getSession: (id) => (connected && id === "session" ? session : null),
    policy: async () => policy,
    audit: () =>
      options.audit ?? { record: async () => {}, append: async () => {} },
  });
  runtime.connectClient(mcp.connectionId);
  const create = (
    mode: "automatic" | "collaborative" = "automatic",
    plan: TaskCommand[] = [
      { program: "pwd", args: [] },
      { program: "df", args: ["-h"] },
    ],
    actor: TaskActor = human,
    requestId = "r1",
  ) =>
    runtime.create(actor, {
      sessionId: "session",
      title: "巡检",
      mode,
      commands: plan,
      requestId,
    });
  const authorize = (task: TaskView, extra: Partial<TaskAuthorization> = {}) =>
    runtime.authorize(human, task.id, {
      ...control.snapshot(),
      policyRevision: policy.revision,
      shellReady: true,
      maxOperations: 10,
      durationMinutes: 10,
      allowReviewedPlan: false,
      ...extra,
    });
  return {
    runtime,
    control,
    writes,
    commands,
    completion,
    policy,
    create,
    authorize,
    disconnect: () => {
      control.close();
      connected = false;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("task runtime: real orchestration contracts", () => {
  it("can finish after takeover cancelled an unsent external proposal, without changing its recorded outcome", async () => {
    const f = fixture();
    const task = await f.create("collaborative", [], mcp);
    const scope = { matches: [{ kind: "program" as const, program: "pwd" }] };
    await f.authorize(task, scope);
    await f.runtime.submit(
      mcp,
      task.id,
      { program: "pwd", args: [] },
      "before",
    );
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    f.control.takeover();
    await f.authorize(f.runtime.get(human, task.id), scope);
    await f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "after");
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    const op = f.runtime.get(human, task.id).operations[1];
    await f.runtime.approve(human, task.id, op.id, op.digest, 1);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("ready"),
    );
    const result = await f.runtime.finish(mcp, task.id);
    expect(result.state).toBe("completed");
    expect(result.operations.map((op) => op.status)).toEqual([
      "cancelled-before-send",
      "succeeded",
    ]);
    expect(f.writes.filter((value) => value === "pwd")).toHaveLength(1);
  });

  it("serializes external commands, keeps retry IDs stable, and inherits the last completed cwd", async () => {
    const f = fixture({ hold: true });
    const task = await f.create("automatic", [], mcp);
    await f.authorize(task, { matches: [{ kind: "program", program: "pwd" }] });
    await f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "first");
    await vi.waitFor(() => expect(f.writes).toContain("pwd"));
    await expect(
      f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "next"),
    ).rejects.toThrow("OPERATION_IN_PROGRESS");
    expect(
      (
        await f.runtime.submit(
          mcp,
          task.id,
          { program: "pwd", args: [] },
          "first",
        )
      ).operations,
    ).toHaveLength(1);
    await expect(
      f.runtime.submit(mcp, task.id, { program: "pwd", args: ["-L"] }, "first"),
    ).rejects.toThrow("REQUEST_CONFLICT");
    f.completion.resolve({
      exitCode: 0,
      output: "first",
      cwd: "/srv/app/child",
    });
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("ready"),
    );
    await f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "next");
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("ready"),
    );
    expect(f.commands[1].cwd).toBe("/srv/app/child");
    expect(f.writes).toEqual(["context", "pwd", "pwd"]);
    expect((await f.runtime.finish(mcp, task.id)).state).toBe("completed");
    expect(f.control.snapshot().controller.kind).toBe("human");
  });

  it("cancelling while authorization audit is pending cannot later grant control", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const f = fixture({
      audit: {
        append: async () => {},
        record: async (type) => {
          if (type === "task.authorization") {
            entered.resolve();
            await release.promise;
          }
        },
      },
    });
    const task = await f.create();
    const authorization = f.authorize(task);
    await entered.promise;
    f.runtime.cancel(human, task.id);
    release.resolve();
    await expect(authorization).rejects.toThrow("STALE_CONTROL");
    expect(f.writes).toEqual([]);
    expect(f.runtime.get(human, task.id).state).toBe("cancelled");
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
  it("cannot execute a human approval when its audit record fails", async () => {
    const f = fixture({
      audit: {
        append: async () => {},
        record: async (type) => {
          if (type === "operation.approval") throw Error("disk full");
        },
      },
    });
    const task = await f.create("collaborative");
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    const op = f.runtime.get(human, task.id).operations[0];
    await expect(
      f.runtime.approve(human, task.id, op.id, op.digest, 1),
    ).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(f.writes).toEqual(["context"]);
    expect(f.runtime.get(human, task.id).state).toBe("paused-error");
  });

  it("cooperative mode waits at every step and exposes exact result and cwd", async () => {
    const f = fixture();
    const task = await f.create("collaborative");
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    expect(f.writes).toEqual(["context"]);
    for (let i = 0; i < 2; i++) {
      const view = f.runtime.get(human, task.id);
      const op = view.operations[i];
      await f.runtime.approve(
        human,
        task.id,
        op.id,
        op.digest,
        view.policyRevision,
      );
      await vi.waitFor(() =>
        expect(f.runtime.get(human, task.id).state).toBe(
          i === 0 ? "awaiting-approval" : "completed",
        ),
      );
    }
    expect(f.writes).toEqual(["context", "pwd", "df"]);
    expect(
      f.runtime.get(human, task.id).operations.map((op) => op.exitCode),
    ).toEqual([0, 0]);
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
  it("automatic mode executes the reviewed sequence without per-command clicks", async () => {
    const f = fixture();
    const task = await f.create();
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("completed"),
    );
    expect(f.writes).toEqual(["context", "pwd", "df"]);
  });
  it("shares the resulting cwd with later steps", async () => {
    const f = fixture();
    const task = await f.create("automatic", [
      { program: "cd", args: ["child"] },
      { program: "pwd", args: [] },
    ]);
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("completed"),
    );
    expect(f.commands[1].cwd).toBe("/srv/app/child");
  });
  it("deduplicates concurrent create requests and refuses changed plans", async () => {
    const gate = deferred<void>();
    const f = fixture({
      audit: { append: async () => {}, record: async () => gate.promise },
    });
    const a = f.create(),
      b = f.create();
    await expect(
      f.create("automatic", [{ program: "uptime", args: [] }]),
    ).rejects.toThrow("REQUEST_CONFLICT");
    gate.resolve();
    expect((await a).id).toBe((await b).id);
    expect(f.runtime.list(human)).toHaveLength(1);
  });
  it("never lets MCP authorize itself or view another client's task", async () => {
    const f = fixture();
    const task = await f.create("automatic", [], mcp);
    await expect(
      f.runtime.authorize(mcp, task.id, {
        shellReady: true,
      } as TaskAuthorization),
    ).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
    expect(() =>
      f.runtime.get(
        { ...mcp, kind: "mcp", clientId: "other" } as TaskActor,
        task.id,
      ),
    ).toThrow("TASK_NOT_FOUND");
    expect(() =>
      f.runtime.get({ kind: "human", userId: "other" }, task.id),
    ).toThrow("TASK_NOT_FOUND");
    expect(f.writes).toEqual([]);
  });
  it("takeover interrupts the running observer and never starts the next step", async () => {
    const f = fixture({ hold: true });
    const task = await f.create();
    await f.authorize(task);
    await vi.waitFor(() => expect(f.writes).toContain("pwd"));
    f.control.humanInput(Buffer.from("manual"));
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).operations[0].status).toBe(
        "unknown",
      ),
    );
    expect(f.runtime.get(human, task.id).state).toBe("paused-human");
    expect(f.writes).toEqual(["context", "pwd", "manual"]);
    await expect(f.authorize(f.runtime.get(human, task.id))).rejects.toThrow(
      "RECONCILIATION_REQUIRED",
    );
    await f.authorize(f.runtime.get(human, task.id), {
      reconciliation: "skip",
    });
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("completed-with-errors"),
    );
    expect(f.writes.filter((x) => x === "pwd")).toHaveLength(1);
    expect(f.writes.at(-1)).toBe("df");
  });
  it("keeps task history readable after session closure", async () => {
    const f = fixture();
    const task = await f.create();
    f.disconnect();
    expect(f.runtime.get(human, task.id).title).toBe("巡检");
    await expect(f.authorize(task)).rejects.toThrow("SESSION_NOT_FOUND");
  });
  it("serializes human authorization and rejects a second concurrent grant", async () => {
    const gate = deferred<void>();
    let waiting = false;
    const f = fixture({
      audit: {
        append: async () => {},
        record: async (type) => {
          if (type === "task.authorization") {
            waiting = true;
            await gate.promise;
          }
        },
      },
    });
    const task = await f.create();
    const pending = f.authorize(task);
    await vi.waitFor(() => expect(waiting).toBe(true));
    await expect(f.authorize(task)).rejects.toThrow("TASK_STATE_INVALID");
    gate.resolve();
    await pending;
  });
  it("deny rules override exact plan authorization", async () => {
    const f = fixture({
      policy: {
        revision: 1,
        sets: [
          {
            id: "global",
            scope: { type: "global" },
            strictAllowlist: false,
            rules: [
              {
                id: "no-pwd",
                effect: "deny",
                match: { kind: "program", program: "pwd" },
                reason: "测试拒绝",
              },
            ],
          },
        ],
      },
    });
    const task = await f.create();
    await f.authorize(task, { allowReviewedPlan: true });
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("paused-error"),
    );
    expect(f.writes).toEqual(["context"]);
  });
  it("checks expiry after delayed audit even for a one-time approval", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const f = fixture({
      audit: {
        record: async () => {},
        append: async (e) => {
          if (e.type === "operation.intent") {
            entered.resolve();
            await release.promise;
          }
        },
      },
    });
    const task = await f.create("collaborative");
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    const op = f.runtime.get(human, task.id).operations[0];
    await f.runtime.approve(human, task.id, op.id, op.digest, 1);
    await entered.promise;
    const original = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(original + 11 * 60_000);
    release.resolve();
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("paused-error"),
    );
    expect(f.writes).toEqual(["context"]);
    vi.restoreAllMocks();
  });
  it("does not send outside the reviewed directory or exceed the task budget", async () => {
    for (const commands of [
      [{ program: "pwd", args: [], cwd: "/elsewhere" }],
      [
        { program: "pwd", args: [] },
        { program: "df", args: [] },
      ],
    ]) {
      const f = fixture();
      const task = await f.create("automatic", commands);
      await f.authorize(task, { maxOperations: 1 });
      await vi.waitFor(() =>
        expect(f.runtime.get(human, task.id).state).toBe("paused-error"),
      );
      expect(f.writes.length).toBeLessThanOrEqual(2);
    }
  });
  it("requires review for opaque commands unless the exact plan was preauthorized", async () => {
    const plan = [{ program: "bash", args: ["-c", "printf hello"] }];
    const f = fixture();
    const task = await f.create("automatic", plan);
    await f.authorize(task);
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
    );
    expect(f.writes).toEqual(["context"]);
    const g = fixture();
    const approved = await g.create("automatic", plan);
    await g.authorize(approved, { allowReviewedPlan: true });
    await vi.waitFor(() =>
      expect(g.runtime.get(human, approved.id).state).toBe("completed"),
    );
    expect(g.writes).toEqual(["context", "bash"]);
  });
});

describe("workflow failure and directory execution behavior", () => {
  it.each(["automatic", "collaborative"] as const)(
    "continues only a known failure in %s mode and preserves a failed final state",
    async (mode) => {
      const f = fixture({ hold: true });
      const task = await f.create(mode, [
        { program: "pwd", args: [], onFailure: "continue" },
        { program: "df", args: ["-h"] },
      ]);
      await f.authorize(task, { allowReviewedPlan: true });
      const approve = async () => {
        await vi.waitFor(() =>
          expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
        );
        const op = f.runtime.get(human, task.id).operations.at(-1)!;
        await f.runtime.approve(human, task.id, op.id, op.digest, 1);
      };
      if (mode === "collaborative") await approve();
      await vi.waitFor(() => expect(f.writes).toContain("pwd"));
      f.completion.resolve({
        exitCode: 7,
        output: "known error",
        cwd: "/srv/app",
      });
      if (mode === "collaborative") await approve();
      await vi.waitFor(() =>
        expect(f.runtime.get(human, task.id).state).toBe(
          "completed-with-errors",
        ),
      );
      const result = f.runtime.get(human, task.id);
      expect(result.hasFailures).toBe(true);
      expect(result.operations.map((op) => op.exitCode)).toEqual([7, 0]);
      expect(f.writes.filter((w) => w === "df")).toHaveLength(1);
      expect(f.control.snapshot().controller.kind).toBe("human");
    },
  );
  it("stops on unknown results even when continue was requested", async () => {
    const f = fixture({ hold: true });
    const task = await f.create("automatic", [
      { program: "pwd", args: [], onFailure: "continue" },
      { program: "df", args: ["-h"] },
    ]);
    await f.authorize(task, { allowReviewedPlan: true });
    await vi.waitFor(() => expect(f.writes).toContain("pwd"));
    f.completion.resolve({ exitCode: null, output: "unknown" });
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("paused-human"),
    );
    expect(f.writes).not.toContain("df");
  });
  it.each(["explicit-cwd", "stateful-shell"] as const)(
    "honors the saved %s directory behavior without mutating the definition",
    async (shellState) => {
      const f = fixture();
      const plan = [
        { program: "cd", args: ["child"] },
        { program: "pwd", args: [] },
      ];
      const task = await f.runtime.create(human, {
        sessionId: "session",
        title: "cwd",
        mode: "automatic",
        commands: plan,
        requestId: "cwd",
        workflow: { id: "template", revision: 1, version: "1.0.0", shellState },
      });
      await f.authorize(task, { allowReviewedPlan: true });
      await vi.waitFor(() =>
        expect(f.runtime.get(human, task.id).state).toBe("completed"),
      );
      expect(f.commands[1].cwd).toBe(
        shellState === "explicit-cwd" ? "/srv/app" : "/srv/app/child",
      );
      expect(plan[1]).not.toHaveProperty("cwd");
    },
  );
});

describe("file save authorization fence", () => {
  it("blocks a task grant while a manual file operation holds the host", async () => {
    const fence = new HostFileFence(),
      scope = { userId: "user-a", hostId: 1 };
    const release = fence.acquire(scope),
      f = fixture({ assertAvailable: () => fence.assertAvailable(scope) });
    const task = await f.create();
    await expect(f.authorize(task)).rejects.toThrow(
      "HOST_FILE_OPERATION_ACTIVE",
    );
    expect(f.writes).toEqual([]);
    release();
    await f.authorize(task, {
      matches: [
        { kind: "program", program: "pwd" },
        { kind: "program", program: "df" },
      ],
    });
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
  });
  it("rechecks the host after an asynchronous authorization audit", async () => {
    const fence = new HostFileFence(),
      scope = { userId: "user-a", hostId: 1 },
      gate = deferred<void>();
    let entered = false;
    const f = fixture({
      assertAvailable: () => fence.assertAvailable(scope),
      audit: {
        append: async () => {},
        record: async (type) => {
          if (type === "task.authorization") {
            entered = true;
            await gate.promise;
          }
        },
      },
    });
    const task = await f.create(),
      pending = f.authorize(task);
    await vi.waitFor(() => expect(entered).toBe(true));
    const release = fence.acquire(scope);
    gate.resolve();
    await expect(pending).rejects.toThrow("HOST_FILE_OPERATION_ACTIVE");
    expect(f.commands).toEqual([]);
    expect(f.control.snapshot().controller.kind).toBe("human");
    release();
  });
});

it("MCP-owned tasks share file and command budgets and retain distinct file outcomes", async () => {
  const calls: string[] = [];
  const f = fixture({
    files: {
      prepare: async (action) => ({
        execute: async (guard) => {
          guard(action.path);
          calls.push(action.type);
          return { status: "succeeded", result: { bytes: 2 } };
        },
        dispose: () => {},
      }),
    },
  });
  const task = await f.create("automatic", [], mcp);
  await f.authorize(task, {
    maxOperations: 2,
    matches: [{ kind: "program", program: "pwd" }],
    fileScopes: [{ kind: "directory", path: "/srv", access: ["read"] }],
  });
  await f.runtime.submitFile(
    mcp,
    task.id,
    { type: "file.read", path: "/srv/config" },
    "read",
  );
  await vi.waitFor(() =>
    expect(f.runtime.get(mcp, task.id).operations[0]?.status).toBe("succeeded"),
  );
  const read = f.runtime.get(mcp, task.id).operations[0];
  expect(read.fileResult?.bytes).toBe(2);
  expect(read.exitCode).toBeUndefined();
  expect(f.writes).toEqual(["context"]);
  await f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "command");
  await vi.waitFor(() =>
    expect(f.runtime.get(mcp, task.id).operations[1]?.status).toBe("succeeded"),
  );
  await f.runtime.submitFile(
    mcp,
    task.id,
    { type: "file.read", path: "/srv/config" },
    "over-budget",
  );
  await vi.waitFor(() =>
    expect(f.runtime.get(mcp, task.id).error).toBe("TASK_BUDGET_EXCEEDED"),
  );
  expect(calls).toEqual(["file.read"]);
});

it.each([
  {
    exitCode: null,
    output: "",
    protocolError: true,
    error: "SHELL_PROTOCOL_INVALID",
  },
  {
    exitCode: null,
    output: "",
    timedOut: true,
    error: "SHELL_CONTEXT_TIMEOUT",
  },
])(
  "returns manual control and sends no plan after $error",
  async ({ error, ...contextResult }) => {
    const f = fixture({ contextResult }),
      task = await f.create();
    try {
      await expect(f.authorize(task)).rejects.toThrow(error);
      expect(f.runtime.get(human, task.id).state).toBe("paused-error");
      expect(f.control.snapshot().controller.kind).toBe("human");
      expect(f.writes).toEqual(["context"]);
      expect(f.commands).toEqual([]);
    } finally {
      f.disconnect();
    }
  },
);

it("serves bounded live pages and fetches full output only on demand", async () => {
  const f = fixture({
    operationOutput: "x".repeat(20000),
    policy: {
      revision: 1,
      sets: [
        {
          id: "allow",
          scope: { type: "global" },
          strictAllowlist: false,
          rules: [
            {
              id: "pwd",
              effect: "allow",
              match: { kind: "program", program: "pwd" },
              reason: "fixture",
            },
          ],
        },
      ],
    },
  });
  const task = await f.create("automatic", [], mcp, "paged");
  await f.authorize(task, {
    maxOperations: 40,
    matches: [{ kind: "program", program: "pwd" }],
  });
  for (let i = 0; i < 30; i++) {
    await f.runtime.submit(
      mcp,
      task.id,
      { program: "pwd", args: ["a".repeat(40000)] },
      "page-" + i,
    );
    await vi.waitFor(
      () => expect(f.runtime.state(mcp, task.id).state).toBe("ready"),
      { interval: 1 },
    );
  }
  const summary = f.runtime.list(human, undefined, { operationLimit: 0 })[0];
  expect(summary.operations).toEqual([]);
  expect(summary.commands).toEqual([]);
  expect(summary.operationPage?.total).toBe(30);
  expect(JSON.stringify(summary)).not.toContain("x".repeat(100));
  const latest = f.runtime.get(human, task.id, { operationLimit: 50 });
  expect(latest.operations.length).toBeLessThan(30);
  expect(latest.operations.at(-1)?.id).toBe(summary.operationPage?.latest?.id);
  expect(
    Buffer.byteLength(JSON.stringify(latest.operations)),
  ).toBeLessThanOrEqual(1024 * 1024);
  expect(latest.operations[0].outputTruncated).toBe(true);
  expect(
    f.runtime.operationDetail(human, task.id, latest.operations[0].id).output,
  ).toHaveLength(20000);
  const ids: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = f.runtime.get(human, task.id, {
      operationLimit: 50,
      operationOffset: offset,
    });
    ids.push(...page.operations.map((o) => o.id));
    offset = page.operationPage?.nextOffset ?? undefined;
  }
  expect(ids).toHaveLength(30);
  expect(new Set(ids).size).toBe(30);
  f.disconnect();
});
it("archives completed tasks, releases subscriptions and refuses to recreate their request IDs", async () => {
  const recorded: Array<{ type: string; data: unknown }> = [],
    f = fixture({
      audit: {
        append: async () => {},
        record: async (type, data) => {
          recorded.push({ type, data });
        },
      },
    });
  let listeners = 0;
  const original = f.control.subscribe.bind(f.control);
  vi.spyOn(f.control, "subscribe").mockImplementation((callback) => {
    listeners++;
    const off = original(callback);
    let closed = false;
    return () => {
      if (!closed) {
        closed = true;
        listeners--;
      }
      off();
    };
  });
  for (let i = 0; i < 130; i++) {
    const task = await f.create("automatic", [], human, "archived-" + i);
    f.runtime.cancel(human, task.id);
    expect(f.runtime.get(human, task.id).canArchive).toBe(true);
    await f.runtime.archive(human, task.id, async () => {});
    expect(() => f.runtime.get(human, task.id)).toThrow("TASK_ARCHIVED");
  }
  expect(listeners).toBe(0);
  expect(f.runtime.list(human)).toEqual([]);
  await expect(f.create("automatic", [], human, "archived-0")).rejects.toThrow(
    "TASK_ARCHIVED",
  );
  expect(recorded.filter((r) => r.type === "task.archived")).toHaveLength(130);
  expect(f.writes).toEqual([]);
  f.disconnect();
});
it("preserves unknown results and keeps a task when archival persistence fails", async () => {
  const active = fixture({ hold: true }),
    task = await active.create();
  await active.authorize(task, { allowReviewedPlan: true });
  await vi.waitFor(() =>
    expect(active.runtime.get(human, task.id).state).toBe("running"),
  );
  const cleanup = vi.fn(async () => {});
  await expect(active.runtime.archive(human, task.id, cleanup)).rejects.toThrow(
    "TASK_NOT_COMPLETE",
  );
  active.runtime.cancel(human, task.id);
  await expect(active.runtime.archive(human, task.id, cleanup)).rejects.toThrow(
    "TASK_ARCHIVE_RECONCILIATION_REQUIRED",
  );
  expect(cleanup).not.toHaveBeenCalled();
  active.disconnect();
  let fail = true;
  const f = fixture({
      audit: {
        append: async () => {},
        record: async (type) => {
          if (fail && type === "task.archived") throw Error("PERSIST_FAILED");
        },
      },
    }),
    ended = await f.create("automatic", [], human, "persist");
  f.runtime.cancel(human, ended.id);
  await expect(
    f.runtime.archive(human, ended.id, async () => {}),
  ).rejects.toThrow("PERSIST_FAILED");
  expect(f.runtime.get(human, ended.id).state).toBe("cancelled");
  fail = false;
  await f.runtime.archive(human, ended.id, async () => {});
  expect(f.runtime.list(human)).toEqual([]);
  f.disconnect();
});

it("records the task host snapshot and trusted human approval separately from MCP origin", async () => {
  const audit = {
    record: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
  };
  const f = fixture({ audit });
  const task = await f.create("collaborative", [], mcp);
  await f.authorize(task, { matches: [{ kind: "program", program: "pwd" }] });
  await f.runtime.submit(
    mcp,
    task.id,
    { program: "pwd", args: [] },
    "provenance",
  );
  await vi.waitFor(() =>
    expect(f.runtime.get(human, task.id).state).toBe("awaiting-approval"),
  );
  expect(audit.append).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "operation.proposed",
      operation: expect.objectContaining({
        context: expect.objectContaining({
          origin: "mcp",
          hostId: 1,
          hostName: "user@server:22",
        }),
      }),
    }),
  );
  expect(audit.record).toHaveBeenCalledWith(
    "task.authorization",
    expect.objectContaining({
      source: "human",
      hostId: 1,
      hostName: "user@server:22",
    }),
  );
  const op = f.runtime.get(human, task.id).operations[0];
  await f.runtime.approve(human, task.id, op.id, op.digest, 1);
  expect(audit.record).toHaveBeenCalledWith(
    "operation.approval",
    expect.objectContaining({
      source: "human",
      hostName: "user@server:22",
      policyRevision: 1,
    }),
  );
  await vi.waitFor(() =>
    expect(f.runtime.get(human, task.id).state).toBe("ready"),
  );
  await f.runtime.finish(mcp, task.id);
});
it.each([
  ["workflow", human],
  ["mcp", mcp],
  ["assistant", { kind: "agent", userId: "user-a", agentRunId: "run-a" }],
] as const)(
  "preserves %s provenance through completion and cancellation",
  async (source, actor) => {
    const audit = {
      record: vi.fn(async () => {}),
      append: vi.fn(async () => {}),
    };
    const f = fixture({ audit });
    try {
      const task = await f.create("automatic", [], actor);
      const provenance = {
        taskId: task.id,
        hostId: 1,
        hostName: "user@server:22",
        sessionId: "session",
        source,
        mode: "automatic",
      };
      expect(audit.record).toHaveBeenCalledWith(
        "task.created",
        expect.objectContaining(provenance),
      );
      await f.authorize(task, {
        matches: [{ kind: "program", program: "pwd" }],
      });
      await f.runtime.finish(actor, task.id);
      expect(audit.record).toHaveBeenCalledWith(
        "task.completed",
        expect.objectContaining({
          ...provenance,
          state: "completed",
          hasFailures: false,
        }),
      );
      const cancelled = await f.create(
        "collaborative",
        [],
        actor,
        "cancel-provenance",
      );
      f.runtime.cancel(human, cancelled.id);
      expect(audit.record).toHaveBeenCalledWith(
        "task.cancelled",
        expect.objectContaining({
          ...provenance,
          taskId: cancelled.id,
          mode: "collaborative",
          state: "cancelled",
          reason: "USER_CANCELLED",
        }),
      );
      expect(f.writes).not.toContain("pwd");
    } finally {
      f.disconnect();
    }
  },
);
it("preserves provenance when a reviewed plan completes automatically", async () => {
  const audit = {
    record: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
  };
  const f = fixture({ audit });
  try {
    const task = await f.create("automatic", [{ program: "pwd", args: [] }]);
    await f.authorize(task, { allowReviewedPlan: true });
    await vi.waitFor(() =>
      expect(f.runtime.get(human, task.id).state).toBe("completed"),
    );
    expect(audit.record).toHaveBeenCalledWith(
      "task.completed",
      expect.objectContaining({
        taskId: task.id,
        hostId: 1,
        hostName: "user@server:22",
        sessionId: "session",
        source: "workflow",
        mode: "automatic",
        state: "completed",
        hasFailures: false,
      }),
    );
    expect(f.commands).toHaveLength(1);
  } finally {
    f.disconnect();
  }
});
