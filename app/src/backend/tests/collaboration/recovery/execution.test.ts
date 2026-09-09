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
      persistRecovery: async (cp) => {
        await store.save(cp.userId, cp, true);
      },
    }),
    service = new TaskRecoveryService(runtime, store);
  const authorize = (task: TaskView, extra: Partial<TaskAuthorization> = {}) =>
    runtime.authorize(user, task.id, {
      ...control.snapshot(),
      policyRevision: 1,
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
