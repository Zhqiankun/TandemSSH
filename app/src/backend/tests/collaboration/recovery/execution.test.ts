import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpCore } from "../../../mcp/core.js";
import { createTandemMcpServer } from "../../../mcp/server.js";
import { WorkflowLibrary } from "../../../collaboration/workflows/library.js";
import { readCheckpoint } from "../../../collaboration/recovery/schema.js";
import type { OperationView } from "../../../collaboration/operations/gateway.js";
import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import {
  TaskRuntime,
  type TaskActor,
} from "../../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../../collaboration/sessions/control.js";
import { TaskRecoveryStore } from "../../../collaboration/recovery/store.js";
import { TaskRecoveryService } from "../../../collaboration/recovery/service.js";
import type {
  TaskView,
  TaskAuthorization,
} from "../../../../types/collaboration-task.js";
const user = { kind: "human" as const, userId: "owner" };
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function storage() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    root = await fs.mkdtemp(path.join(cache, "task-recovery-")),
    key = randomBytes(32),
    keys = { load: async () => key };
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== cache ||
      !path.basename(actual).startsWith("task-recovery-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  return { root, keys, store: new TaskRecoveryStore(root, keys) };
}
function fixture(
  store: TaskRecoveryStore,
  options: {
    peer?: string;
    hostId?: number;
    fail?: boolean;
    confirm?: boolean;
    takeoverAfterFirst?: boolean;
  } = {},
) {
  const id = randomUUID(),
    writes: string[] = [],
    control = new SessionControl(
      id,
      {
        isReady: () => true,
        write: (bytes) => writes.push(Buffer.from(bytes).toString()),
      },
      () => {},
    ),
    session = {
      id,
      userId: user.userId,
      hostId: options.hostId ?? 1,
      hostName: "fixture@server:22",
      acceptedHostKey: options.peer ?? "SHA256:fixture",
      groups: () => [],
      control,
      executor: {
        prepareContext: () => ({
          bytes: Buffer.from("context"),
          completion: Promise.resolve({
            exitCode: 0,
            output: "",
            cwd: "/srv/app",
          }),
          dispose: () => {},
        }),
        prepare: async (action: { program: string }) => ({
          bytes: Buffer.from(action.program),
          completion: Promise.resolve({
            exitCode: options.fail ? null : 0,
            output: action.program,
            cwd: "/srv/app",
            protocolError: options.fail,
          }),
          dispose: () => {},
        }),
      },
    };
  const recoveryWrites = new Set<Promise<unknown>>();
  const runtime = new TaskRuntime({
      getSession: (s) => (s === id ? session : null),
      policy: async () => ({
        revision: 1,
        sets: options.confirm
          ? [
              {
                id: "review",
                scope: { type: "global" as const },
                strictAllowlist: false,
                rules: ["deploy_phase_one", "deploy_phase_two"].map(
                  (program) => ({
                    id: program,
                    effect: "confirm" as const,
                    match: { kind: "program" as const, program },
                    reason: "Test explicit review",
                  }),
                ),
              },
            ]
          : [],
      }),
      audit: () => ({
        record: async () => {},
        append: async (event: { type: string; operation: OperationView }) => {
          if (
            options.takeoverAfterFirst &&
            event.type === "operation.completed" &&
            event.operation.action.type === "terminal.command" &&
            event.operation.action.program === "deploy_phase_one"
          )
            control.takeover();
        },
      }),
      persistRecovery: async (cp, finished) => {
        const write = store.save(cp.userId, cp, !finished);
        recoveryWrites.add(write);
        try {
          await write;
        } finally {
          recoveryWrites.delete(write);
        }
      },
    }),
    service = new TaskRecoveryService(runtime, store);
  const authorize = (task: TaskView, extra: Partial<TaskAuthorization> = {}) =>
    runtime.authorize(user, task.id, {
      ...control.snapshot(),
      policyRevision: 1,
      planRevision: task.planRevision,
      shellReady: true,
      maxOperations: 10,
      durationMinutes: 10,
      allowReviewedPlan: false,
      ...extra,
    });
  const create = (
    mode: "automatic" | "collaborative" = "collaborative",
    actor: TaskActor = user,
  ) =>
    runtime.create(actor, {
      sessionId: id,
      requestId: randomUUID(),
      title: "部署检查",
      mode,
      commands: [
        { program: "deploy_phase_one", args: [] },
        { program: "deploy_phase_two", args: [] },
      ],
    });
  const approve = async (taskId: string) => {
    const op = runtime.get(user, taskId).operations.at(-1)!;
    await runtime.approve(user, taskId, op.id, op.digest, 1);
  };
  cleanup.push(async () => {
    control.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    while (recoveryWrites.size) {
      await Promise.allSettled([...recoveryWrites]);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
  return { id, writes, control, runtime, service, authorize, create, approve };
}
async function savedAfterFirst(
  mode: "automatic" | "collaborative" = "collaborative",
) {
  const s = await storage(),
    f = fixture(s.store, {
      confirm: true,
      takeoverAfterFirst: mode === "automatic",
    }),
    task = await f.create(mode);
  await f.authorize(task);
  if (mode === "collaborative") {
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id).state).toBe("awaiting-approval"),
    );
    await f.approve(task.id);
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id)).toMatchObject({
        state: "awaiting-approval",
        nextStep: 1,
      }),
    );
  } else
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id).state).toBe("paused-human"),
    );
  const saved = await f.service.save(user, task.id);
  expect(f.writes.filter((x) => x !== "context")).toEqual(["deploy_phase_one"]);
  return { s, f, task, saved };
}
it.each(["automatic", "collaborative"] as const)(
  "restores %s with no old writes or approvals and continues only the remaining step",
  async (mode) => {
    const { s, saved } = await savedAfterFirst(mode),
      next = fixture(new TaskRecoveryStore(s.root, s.keys)),
      restored = await next.service.restore(user, saved.id, {
        sessionId: next.id,
        reviewed: true,
      });
    expect(restored).toMatchObject({
      state: "awaiting-authorization",
      nextStep: 1,
      recovery: { completedSteps: 1 },
    });
    expect(next.writes).toEqual([]);
    await next.authorize(restored, { allowReviewedPlan: mode === "automatic" });
    if (mode === "collaborative") {
      await vi.waitFor(() =>
        expect(next.runtime.get(user, restored.id).state).toBe(
          "awaiting-approval",
        ),
      );
      expect(next.writes).toEqual(["context"]);
      await next.approve(restored.id);
    }
    await vi.waitFor(() =>
      expect(next.runtime.get(user, restored.id).state).toBe("completed"),
    );
    expect(next.writes.filter((x) => x !== "context")).toEqual([
      "deploy_phase_two",
    ]);
    const cp = await s.store.get(user.userId, restored.id);
    expect(cp?.checkpoint.nextStep).toBe(2);
    const files = await fs.readdir(path.join(s.root, "tandem-task-recovery"), {
      recursive: true,
    });
    for (const file of files.filter((f) => f.endsWith(".checkpoint"))) {
      const bytes = await fs.readFile(
        path.join(s.root, "tandem-task-recovery", file),
      );
      expect(bytes.includes(Buffer.from("deploy_phase_two"))).toBe(false);
      expect(bytes.includes(Buffer.from("fixture@server"))).toBe(false);
    }
  },
);
it("rejects changed host keys and other users without consuming the saved task", async () => {
  const { s, saved } = await savedAfterFirst(),
    next = fixture(new TaskRecoveryStore(s.root, s.keys), {
      peer: "SHA256:changed",
    });
  await expect(
    next.service.restore(user, saved.id, {
      sessionId: next.id,
      reviewed: true,
    }),
  ).rejects.toThrow("TASK_RECOVERY_HOST_CHANGED");
  expect(next.writes).toEqual([]);
  expect((await s.store.get(user.userId, saved.id))?.state).toBe("available");
  expect(
    await next.service.list({ kind: "human", userId: "someone-else" }),
  ).toEqual([]);
});
it("prevents execution when a resumed task cannot persist the next action", async () => {
  const { s, saved } = await savedAfterFirst(),
    store = new TaskRecoveryStore(s.root, s.keys),
    next = fixture(store),
    restored = await next.service.restore(user, saved.id, {
      sessionId: next.id,
      reviewed: true,
    });
  vi.spyOn(store, "save").mockRejectedValue(Error("TASK_RECOVERY_DISK_FULL"));
  await next.authorize(restored, { allowReviewedPlan: true });
  await vi.waitFor(() =>
    expect(next.runtime.get(user, restored.id).state).toBe("paused-error"),
  );
  expect(next.writes.filter((x) => x !== "context")).toEqual([]);
});
it("allows only one store instance to claim a saved task", async () => {
  const { s, saved } = await savedAfterFirst(),
    other = new TaskRecoveryStore(s.root, s.keys),
    results = await Promise.allSettled([
      s.store.claim(user.userId, saved.id),
      other.claim(user.userId, saved.id),
    ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("does not cancel the original paused task when encryption is unavailable", async () => {
  const s = await storage(),
    store = new TaskRecoveryStore(s.root, {
      load: async () => {
        throw Error("No key");
      },
    }),
    f = fixture(store),
    task = await f.create();
  await expect(f.service.save(user, task.id)).rejects.toThrow(
    "TASK_RECOVERY_ENCRYPTION_UNAVAILABLE",
  );
  expect(f.runtime.get(user, task.id).state).toBe("paused-error");
  expect(f.writes).toEqual([]);
});
it("requires desktop reconciliation for an unknown MCP result after recovery", async () => {
  const s = await storage(),
    f = fixture(s.store, { fail: true }),
    clientId = randomUUID(),
    mcp: TaskActor = {
      kind: "mcp",
      userId: user.userId,
      clientId,
      connectionId: randomUUID(),
      allowedHostIds: [1],
    };
  f.runtime.connectClient(mcp.connectionId);
  const task = await f.runtime.create(mcp, {
    sessionId: f.id,
    requestId: randomUUID(),
    title: "Codex task",
    mode: "automatic",
  });
  await f.authorize(task, { matches: [{ kind: "program", program: "pwd" }] });
  await f.runtime.submit(mcp, task.id, { program: "pwd", args: [] }, "one");
  await vi.waitFor(() =>
    expect(f.runtime.get(user, task.id).operations.at(-1)?.status).toBe(
      "unknown",
    ),
  );
  const saved = await f.service.save(mcp, task.id);
  const next = fixture(new TaskRecoveryStore(s.root, s.keys)),
    reconnected = { ...mcp, connectionId: randomUUID() };
  next.runtime.connectClient(reconnected.connectionId);
  const restored = await next.service.restore(reconnected, saved.id, {
    sessionId: next.id,
    reviewed: true,
  });
  expect(restored.reconciliationRequired).toBe(true);
  await expect(next.authorize(restored)).rejects.toThrow(
    "RECONCILIATION_REQUIRED",
  );
  expect(next.writes).toEqual([]);
  await next.authorize(restored, {
    reconciliation: "skip",
    matches: [{ kind: "program", program: "pwd" }],
  });
  expect(next.runtime.get(user, restored.id).hasFailures).toBe(true);
});

it("hides MCP recovery records from other clients and hosts even when they know the record ID", async () => {
  const s = await storage(),
    f = fixture(s.store),
    client: TaskActor = {
      kind: "mcp",
      userId: user.userId,
      clientId: randomUUID(),
      connectionId: randomUUID(),
      allowedHostIds: [1],
    };
  f.runtime.connectClient(client.connectionId);
  const task = await f.runtime.create(client, {
    sessionId: f.id,
    requestId: randomUUID(),
    title: "owned recovery",
    mode: "collaborative",
  });
  const saved = await f.service.save(client, task.id);
  const other = { ...client, clientId: randomUUID() };
  expect(await f.service.list(other)).toEqual([]);
  await expect(
    f.service.restore(other, saved.id, { sessionId: f.id, reviewed: true }),
  ).rejects.toThrow("TASK_RECOVERY_NOT_FOUND");
  expect(await f.service.list({ ...client, allowedHostIds: [] })).toEqual([]);
  expect((await s.store.get(user.userId, saved.id))?.state).toBe("available");
});

it("cannot authorize a new task before its recovery claim and checkpoint are durable", async () => {
  const { s, saved } = await savedAfterFirst(),
    store = new TaskRecoveryStore(s.root, s.keys),
    next = fixture(store),
    save = store.save.bind(store);
  let entered = false,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  vi.spyOn(store, "save").mockImplementation(async (user, cp, live) => {
    if (live) {
      entered = true;
      await gate;
    }
    return save(user, cp, live);
  });
  const recovering = next.service.restore(user, saved.id, {
    sessionId: next.id,
    reviewed: true,
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  const staged = next.runtime.list(user)[0];
  await expect(
    next.authorize(staged, { allowReviewedPlan: true }),
  ).rejects.toThrow("TASK_RECOVERY_BUSY");
  expect(next.writes).toEqual([]);
  release();
  const restored = await recovering;
  await next.authorize(restored, { allowReviewedPlan: true });
  await vi.waitFor(() =>
    expect(next.runtime.get(user, restored.id).state).toBe("awaiting-approval"),
  );
  await next.approve(restored.id);
  await vi.waitFor(() =>
    expect(next.runtime.get(user, restored.id).state).toBe("completed"),
  );
});

async function savedParent(mode: "automatic" | "collaborative") {
  const s = await storage(),
    f = fixture(s.store, { takeoverAfterFirst: mode === "automatic" }),
    client: TaskActor = {
      kind: "mcp",
      userId: user.userId,
      clientId: randomUUID(),
      connectionId: randomUUID(),
      allowedHostIds: [1],
    };
  f.runtime.connectClient(client.connectionId);
  const task = await f.runtime.create(client, {
    sessionId: f.id,
    requestId: randomUUID(),
    title: "parent deployment",
    mode,
  });
  await f.authorize(task, {
    matches: [
      { kind: "program", program: "deploy_phase_one" },
      { kind: "program", program: "deploy_phase_two" },
      { kind: "program", program: "pwd" },
    ],
  });
  const workflow = await f.runtime.attachWorkflow(client, task.id, {
    requestId: randomUUID(),
    name: "saved child",
    workflow: {
      id: randomUUID(),
      revision: 1,
      version: "1.0.0",
      shellState: "explicit-cwd",
    },
    commands: [
      { program: "deploy_phase_one", args: [] },
      { program: "deploy_phase_two", args: [] },
    ],
    expectedControl: f.control.snapshot(),
  });
  if (mode === "collaborative") {
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id).state).toBe("awaiting-approval"),
    );
    await f.approve(task.id);
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id)).toMatchObject({
        nextStep: 1,
        state: "awaiting-approval",
      }),
    );
  } else
    await vi.waitFor(() =>
      expect(f.runtime.get(user, task.id).state).toBe("paused-human"),
    );
  const saved = await f.service.save(client, task.id),
    record = await s.store.get(user.userId, saved.id);
  expect(record?.checkpoint).toMatchObject({
    nextStep: 1,
    resourceRecoveryRequired: false,
    workflowState: { activeRunId: workflow.id, initialPlan: { steps: [] } },
  });
  return { s, f, client, task, workflow, saved, record };
}
it.each(["automatic", "collaborative"] as const)(
  "restores %s parent workflow, preserves old results and returns to the parent task",
  async (mode) => {
    const { s, f, client, task, workflow, saved } = await savedParent(mode),
      next = fixture(new TaskRecoveryStore(s.root, s.keys)),
      newClient = { ...client, connectionId: randomUUID() };
    next.runtime.connectClient(newClient.connectionId);
    const restored = await next.service.restore(newClient, saved.id, {
      sessionId: next.id,
      reviewed: true,
    });
    expect(restored).toMatchObject({
      state: "awaiting-authorization",
      nextStep: 1,
      activeWorkflowRunId: workflow.id,
    });
    expect(next.writes).toEqual([]);
    const old = f.runtime.workflowOperation(
      client,
      task.id,
      workflow.id,
      f.runtime.workflowRunSummary(client, task.id, workflow.id)
        .operationIds[0],
    );
    expect(
      next.runtime.workflowOperation(
        newClient,
        restored.id,
        workflow.id,
        old.id,
      ).status,
    ).toBe("succeeded");
    expect(() =>
      next.runtime.operation(newClient, restored.id, old.id),
    ).toThrow("OPERATION_NOT_FOUND");
    await expect(
      next.runtime.approve(user, restored.id, old.id, old.digest, 1),
    ).rejects.toThrow("STALE_APPROVAL");
    await next.authorize(restored, {
      allowReviewedPlan: true,
      matches: [{ kind: "program", program: "pwd" }],
    });
    if (mode === "collaborative") {
      await vi.waitFor(() =>
        expect(next.runtime.get(user, restored.id).state).toBe(
          "awaiting-approval",
        ),
      );
      await next.approve(restored.id);
    }
    await vi.waitFor(() =>
      expect(next.runtime.get(user, restored.id)).toMatchObject({
        state: "ready",
        activeWorkflowRunId: undefined,
        stepCount: 0,
      }),
    );
    const library = new WorkflowLibrary({
        read: () => {
          throw Error("Restored result must not read mutable template");
        },
        write: async () => {},
        ownsHost: async () => true,
        target: () => ({
          hostId: 1,
          groups: [],
          control: next.control.snapshot(),
        }),
        policy: () => ({ revision: 1, sets: [] }),
        tasks: next.runtime,
        audit: async () => {},
      }),
      result = library.result(newClient, restored.id, workflow.id);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      state: "completed",
      nextStep: 2,
      stepCount: 2,
      restoredFromTaskId: task.id,
    });
    expect(
      result.operations
        .filter((o) => o.status === "succeeded")
        .map((o) => o.program),
    ).toEqual(["deploy_phase_one", "deploy_phase_two"]);
    expect(next.writes.filter((v) => v !== "context")).toEqual([
      "deploy_phase_two",
    ]);
    await next.runtime.submit(
      newClient,
      restored.id,
      { program: "pwd", args: [] },
      "parent-continues",
    );
    if (mode === "collaborative") {
      await vi.waitFor(() =>
        expect(next.runtime.get(user, restored.id).state).toBe(
          "awaiting-approval",
        ),
      );
      await next.approve(restored.id);
    }
    await vi.waitFor(() =>
      expect(
        next.runtime.get(user, restored.id).operations.at(-1)?.status,
      ).toBe("succeeded"),
    );
    expect(next.writes.filter((v) => v !== "context")).toEqual([
      "deploy_phase_two",
      "pwd",
    ]);
    await vi.waitFor(() =>
      expect(next.runtime.get(user, restored.id).state).toBe("ready"),
    );
    await next.runtime.finish(newClient, restored.id);
    expect(
      (await next.service.list(newClient)).find((r) => r.id === restored.id)
        ?.state,
    ).toBe("completed");
    await expect(
      next.service.restore(newClient, restored.id, {
        sessionId: next.id,
        reviewed: true,
      }),
    ).rejects.toThrow("TASK_RECOVERY_NOT_AVAILABLE");
  },
);
it("rejects orphan parent operation IDs and a changed restored plan", async () => {
  const { record } = await savedParent("collaborative"),
    cp = record!.checkpoint;
  const orphan = structuredClone(cp);
  orphan.workflowState!.runs[0].summary.operationIds.push(randomUUID());
  expect(() => readCheckpoint(orphan)).toThrow("TASK_RECOVERY_INVALID");
  const changed = structuredClone(cp);
  changed.workflowState!.runs[0].steps[0] = { program: "unexpected", args: [] };
  expect(() => readCheckpoint(changed)).toThrow("TASK_RECOVERY_INVALID");
});

it("records the human decision for an unknown parent step and retains the workflow failure status", async () => {
  const s = await storage(),
    f = fixture(s.store, { fail: true }),
    client: TaskActor = {
      kind: "mcp",
      userId: user.userId,
      clientId: randomUUID(),
      connectionId: randomUUID(),
      allowedHostIds: [1],
    };
  f.runtime.connectClient(client.connectionId);
  const task = await f.runtime.create(client, {
    sessionId: f.id,
    requestId: randomUUID(),
    title: "unknown child",
    mode: "automatic",
  });
  await f.authorize(task, {
    matches: [
      { kind: "program", program: "pwd" },
      { kind: "program", program: "printf" },
    ],
  });
  const run = await f.runtime.attachWorkflow(client, task.id, {
    requestId: randomUUID(),
    name: "child",
    workflow: {
      id: randomUUID(),
      revision: 1,
      version: "1",
      shellState: "explicit-cwd",
    },
    commands: [
      { program: "pwd", args: [] },
      { program: "printf", args: [] },
    ],
    expectedControl: f.control.snapshot(),
  });
  await vi.waitFor(() =>
    expect(f.runtime.get(user, task.id).operations[0]?.status).toBe("unknown"),
  );
  const saved = await f.service.save(client, task.id),
    next = fixture(new TaskRecoveryStore(s.root, s.keys)),
    newClient = { ...client, connectionId: randomUUID() };
  next.runtime.connectClient(newClient.connectionId);
  const restored = await next.service.restore(newClient, saved.id, {
    sessionId: next.id,
    reviewed: true,
  });
  expect(restored.reconciliationRequired).toBe(true);
  await expect(next.authorize(restored)).rejects.toThrow(
    "RECONCILIATION_REQUIRED",
  );
  await next.authorize(restored, { reconciliation: "skip" });
  await vi.waitFor(() =>
    expect(next.runtime.get(user, restored.id)).toMatchObject({
      state: "ready",
      activeWorkflowRunId: undefined,
    }),
  );
  const summary = next.runtime.workflowRunSummary(
    newClient,
    restored.id,
    run.id,
  );
  expect(summary).toMatchObject({
    state: "completed-with-errors",
    hasFailures: true,
    nextStep: 2,
  });
  const original = next.runtime.workflowOperation(
    newClient,
    restored.id,
    run.id,
    summary.operationIds[0],
  );
  expect(original).toMatchObject({
    status: "unknown",
    reviewed: { decision: "skip" },
  });
  expect(next.writes.filter((v) => v !== "context")).toEqual(["printf"]);
});

it.each(["automatic", "collaborative"] as const)(
  "%s MCP recovery isolates checkpoints and reconnects without inheriting authorization",
  async (mode) => {
    const s = await storage(),
      f = fixture(s.store);
    const owner = {
      userId: user.userId,
      clientId: randomUUID(),
      connectionId: randomUUID(),
      allowedHostIds: [1],
      readTerminal: false,
    };
    f.runtime.connectClient(owner.connectionId);
    const task = await f.runtime.create(
      { kind: "mcp", ...owner },
      {
        sessionId: f.id,
        requestId: randomUUID(),
        title: "恢复权限验证",
        mode,
      },
    );
    let principal = owner;
    const compose = (target: ReturnType<typeof fixture>) =>
      new McpCore({
        tasks: target.runtime,
        recovery: target.service,
        hosts: async () => [],
        sessions: () => [],
        output: () => {
          throw Error("UNEXPECTED_OUTPUT");
        },
        open: async () => {
          throw Error("UNEXPECTED_OPEN");
        },
      });
    let core = compose(f);
    const server = createTandemMcpServer({
      invoke: (m, p, signal) =>
        core.invoke(principal, m, p, signal ?? new AbortController().signal),
    });
    const client = new Client({ name: "recovery-permissions", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
      return r.structuredContent!.result;
    };
    const saved = (await call("save_task_progress", { taskId: task.id })) as {
      id: string;
    };
    const record = await s.store.get(user.userId, saved.id);
    expect(record?.state).toBe("available");
    const before = structuredClone(f.runtime.get(user, task.id));
    for (const foreign of [
      { ...owner, userId: "stranger" },
      { ...owner, clientId: randomUUID() },
      { ...owner, allowedHostIds: [2] },
    ]) {
      principal = foreign;
      expect(await call("list_saved_tasks", {})).toEqual([]);
      for (const attempted of [
        {
          name: "get_saved_task",
          arguments: { id: saved.id },
          error: "TASK_RECOVERY_NOT_FOUND",
        },
        {
          name: "restore_task_progress",
          arguments: { id: saved.id, sessionId: f.id },
          error: "TASK_RECOVERY_NOT_FOUND",
        },
        {
          name: "save_task_progress",
          arguments: { taskId: task.id },
          error: "TASK_NOT_FOUND",
        },
      ]) {
        const denied = await client.callTool(attempted);
        expect(denied.isError).toBe(true);
        expect(denied.structuredContent).toMatchObject({
          error: { code: attempted.error },
        });
        expect(denied.structuredContent).not.toHaveProperty("result");
        expect(await s.store.get(user.userId, saved.id)).toEqual(record);
        expect(f.runtime.get(user, task.id)).toEqual(before);
        expect(f.writes).toEqual([]);
      }
    }
    const next = fixture(new TaskRecoveryStore(s.root, s.keys));
    principal = { ...owner, connectionId: randomUUID() };
    next.runtime.connectClient(principal.connectionId);
    core = compose(next);
    expect(await call("list_saved_tasks", {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: saved.id })]),
    );
    expect(await call("get_saved_task", { id: saved.id })).toMatchObject({
      summary: { id: saved.id },
    });
    const restored = (await call("restore_task_progress", {
      id: saved.id,
      sessionId: next.id,
    })) as TaskView;
    expect(restored.id).not.toBe(task.id);
    expect(restored.state).toBe("awaiting-authorization");
    expect(restored.mode).toBe(mode);
    expect(next.writes).toEqual([]);
    expect(next.control.snapshot().controller.kind).toBe("human");
    expect((await s.store.get(user.userId, saved.id))?.state).toBe("consumed");
    const duplicate = await client.callTool({
      name: "restore_task_progress",
      arguments: { id: saved.id, sessionId: next.id },
    });
    expect(duplicate.isError).toBe(true);
    expect(next.runtime.list(user)).toHaveLength(1);
    expect(next.writes).toEqual([]);
  },
);
