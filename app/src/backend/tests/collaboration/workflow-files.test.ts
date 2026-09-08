import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../collaboration/workflows/definition";
import { canContinueStepFailure } from "../../collaboration/tasks/plan";
import type { WorkflowDefinition } from "../../../types/workflow";
import type {
  TaskAuthorization,
  TaskMode,
} from "../../../types/collaboration-task";
import type { TaskFileBindings } from "../../../types/task-plan";
import type { OperationView } from "../../collaboration/operations/gateway";
const source: WorkflowDefinition = {
  schemaVersion: 2,
  id: "deploy",
  name: "上传并检查",
  version: "1.0.0",
  files: {
    artifact: { direction: "upload" },
    result: { direction: "download" },
  },
  parameters: { remote: { type: "remote-path", default: "/srv/产物.bin" } },
  defaults: { cwd: "/srv" },
  steps: [
    {
      id: "upload",
      name: "上传产物",
      action: {
        type: "upload",
        path: { param: "remote" },
        localFile: "artifact",
      },
    },
    {
      id: "check",
      name: "检查目录",
      action: { type: "command", program: "pwd", args: [] },
    },
    {
      id: "download",
      name: "下载结果",
      action: {
        type: "download",
        path: { param: "remote" },
        localFile: "result",
      },
    },
  ],
};
type Fixture = Awaited<ReturnType<typeof transferToolsFixture>>;
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
async function setup(definition = source) {
  const f = await transferToolsFixture();
  closers.push(f.close);
  const saved = await f.workflows.save("owner", {
    definition,
    allowedHostIds: [7],
  });
  return { ...f, saved };
}
async function task(
  f: Awaited<ReturnType<typeof setup>>,
  mode: TaskMode = "automatic",
) {
  const preview = f.workflows.preview(f.actor, {
    workflowId: f.saved.id,
    sessionId: f.sessionId,
    parameters: {},
  });
  expect(preview.commands).toHaveLength(
    source.steps.filter((s) => s.action.type === "command").length,
  );
  return f.workflows.start(f.actor, preview.id, randomUUID(), mode);
}
async function bindings(f: Fixture, id: string): Promise<TaskFileBindings> {
  const selected = await f.select(id);
  return Object.fromEntries(
    selected.map((g) => [
      g.direction === "upload" ? "artifact" : "result",
      { localGrantId: g.id, localVersion: g.version },
    ]),
  );
}
function authorize(
  f: Fixture,
  id: string,
  fileBindings: TaskFileBindings,
  extra: Partial<TaskAuthorization> = {},
) {
  return f.runtime.authorize(f.human, id, {
    ...f.control.snapshot(),
    policyRevision: 1,
    shellReady: true,
    maxOperations: 12,
    durationMinutes: 10,
    allowReviewedPlan: false,
    matches: [{ kind: "program", program: "pwd" }],
    fileScopes: [
      { kind: "directory", path: "/srv", access: ["read", "write"] },
    ],
    fileBindings,
    ...extra,
  });
}
async function approveNext(f: Fixture, id: string, type: string) {
  await vi.waitFor(
    () => {
      const view = f.runtime.get(f.human, id);
      expect(view.state).toBe("awaiting-approval");
      expect(view.operations.at(-1)?.action.type).toBe(type);
    },
    { timeout: 10000 },
  );
  const op = f.runtime.get(f.human, id).operations.at(-1)!;
  await f.runtime.approve(f.human, id, op.id, op.digest, 1);
}
async function complete(f: Fixture, id: string) {
  await vi.waitFor(
    () => expect(f.runtime.get(f.human, id).state).toBe("completed"),
    { timeout: 10000 },
  );
}

describe("versioned file workflow definitions", () => {
  it("preserves mixed ordering and exports reusable slots without runtime grants", async () => {
    const f = await setup(),
      compiled = compileWorkflow(source, {});
    expect(compiled.plan.map((s) => s.stepId)).toEqual([
      "upload",
      "check",
      "download",
    ]);
    expect(compiled.commands.map((c) => c.program)).toEqual(["pwd"]);
    const preview = f.workflows.preview(f.actor, {
      workflowId: f.saved.id,
      sessionId: f.sessionId,
      parameters: {},
    });
    expect(preview.plan).toHaveLength(3);
    expect(preview.decisions).toHaveLength(3);
    expect(f.writes).toEqual([]);
    const exported = f.workflows.export("owner", f.saved.id);
    expect(parseWorkflow(exported.definition)).toEqual(source);
    expect(JSON.stringify(exported)).not.toMatch(
      /localGrantId|localVersion|localPath/,
    );
  });
  it("rejects old schema, mismatched slots, repeated download slots and file cwd", () => {
    expect(() => parseWorkflow({ ...source, schemaVersion: 1 })).toThrow(
      "WORKFLOW_FILE_SCHEMA_REQUIRED",
    );
    expect(() =>
      parseWorkflow({
        ...source,
        files: {
          artifact: { direction: "download" },
          result: { direction: "download" },
        },
      }),
    ).toThrow("WORKFLOW_FILE_SLOT_INVALID");
    expect(() =>
      parseWorkflow({
        ...source,
        steps: [...source.steps, { ...source.steps[2], id: "again" }],
      }),
    ).toThrow("WORKFLOW_DOWNLOAD_SLOT_REUSED");
    expect(() =>
      parseWorkflow({
        ...source,
        steps: [{ ...source.steps[0], cwd: "/srv" }],
      }),
    ).toThrow("WORKFLOW_FILE_CWD_UNSUPPORTED");
    expect(() => compileWorkflow(source, { remote: "/" })).toThrow(
      "INVALID_FILE_PATH",
    );
    expect(() =>
      parseWorkflow({
        ...source,
        files: { artifact: { direction: "upload", localPath: "C:/secret" } },
      }),
    ).toThrow("INVALID_WORKFLOW");
  });
});
it.each(["automatic", "collaborative"] as const)(
  "%s executes saved upload -> command -> download with exact bytes",
  async (mode) => {
    const f = await setup(),
      t = await task(f, mode),
      bound = await bindings(f, t.id);
    expect(t.stepCount).toBe(3);
    expect(t.plan).toHaveLength(3);
    await authorize(f, t.id, bound);
    if (mode === "collaborative")
      for (const type of ["file.upload", "terminal.command", "file.download"])
        await approveNext(f, t.id, type);
    await complete(f, t.id);
    const result = f.runtime.get(f.human, t.id);
    expect(result.operations.map((o) => o.action.type)).toEqual([
      "file.upload",
      "terminal.command",
      "file.download",
    ]);
    expect(result.operations.every((o) => o.status === "succeeded")).toBe(true);
    expect(await f.remote.read("/srv/产物.bin")).toEqual(f.bytes);
    expect(await fs.readFile(f.destination)).toEqual(f.bytes);
    expect(f.writes).toEqual(["context", "pwd"]);
    expect(result.operations[0].fileResult?.transfer?.verification).toBe(
      "sha256",
    );
    expect(
      f.grants.list("owner", t.id).find((g) => g.direction === "download")
        ?.error,
    ).toBe("FILE_LOCAL_TASK_ENDED");
  },
);
it("rejects missing, foreign, revoked bindings before any terminal or file write", async () => {
  const f = await setup(),
    t = await task(f);
  await expect(authorize(f, t.id, {})).rejects.toThrow(
    "WORKFLOW_FILE_BINDING_REQUIRED",
  );
  const other = await f.runtime.create(f.actor, {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      title: "other",
      mode: "automatic",
    }),
    foreign = await bindings(f, other.id);
  await expect(authorize(f, t.id, foreign)).rejects.toThrow(/GRANT/);
  const bound = await bindings(f, t.id);
  await f.grants.revoke("owner", t.id, bound.artifact.localGrantId);
  await expect(authorize(f, t.id, bound)).rejects.toThrow(/GRANT/);
  expect(f.writes).toEqual([]);
  expect(f.remote.writes).toHaveLength(0);
});
it("resumes after takeover without revalidating or repeating a completed upload", async () => {
  const f = await setup(),
    t = await task(f, "collaborative"),
    bound = await bindings(f, t.id);
  await authorize(f, t.id, bound);
  await approveNext(f, t.id, "file.upload");
  await vi.waitFor(
    () => expect(f.runtime.get(f.human, t.id).nextStep).toBe(1),
    { timeout: 10000 },
  );
  await f.runtime.takeover(f.human, f.sessionId);
  await f.grants.revoke("owner", t.id, bound.artifact.localGrantId);
  const writes = f.remote.writes.length;
  await authorize(f, t.id, bound);
  await approveNext(f, t.id, "terminal.command");
  await approveNext(f, t.id, "file.download");
  await complete(f, t.id);
  expect(f.remote.writes.length).toBe(writes);
  expect(await fs.readFile(f.destination)).toEqual(f.bytes);
  expect(
    f.runtime
      .get(f.human, t.id)
      .operations.filter((o) => o.action.type === "file.upload"),
  ).toHaveLength(1);
});
it.each(["stop", "continue"] as const)(
  "file not found respects explicit %s and records the failed step",
  async (onFailure) => {
    const definition = structuredClone(source);
    definition.steps = [
      {
        ...definition.steps[2],
        onFailure,
        action: {
          type: "download",
          localFile: "result",
          path: "/srv/missing.bin",
        },
      },
      definition.steps[1],
    ];
    const f = await setup(definition),
      t = await task(f),
      bound = await bindings(f, t.id);
    delete bound.artifact;
    await authorize(f, t.id, bound);
    await vi.waitFor(
      () =>
        expect(f.runtime.get(f.human, t.id).state).toBe(
          onFailure === "stop" ? "paused-error" : "completed-with-errors",
        ),
      { timeout: 10000 },
    );
    const view = f.runtime.get(f.human, t.id);
    expect(view.operations[0].status).toBe("failed");
    expect(view.operations).toHaveLength(onFailure === "stop" ? 1 : 2);
    expect(f.writes.includes("pwd")).toBe(onFailure === "continue");
    await expect(fs.stat(f.destination)).rejects.toThrow();
  },
);
it("rejects duplicate download destinations before execution", async () => {
  const definition = structuredClone(source);
  definition.files!.result2 = { direction: "download" };
  definition.steps.push({
    id: "other",
    name: "另一结果",
    action: { type: "download", path: "/srv/产物.bin", localFile: "result2" },
  });
  const f = await setup(definition),
    t = await task(f),
    bound = await bindings(f, t.id);
  bound.result2 = bound.result;
  await expect(authorize(f, t.id, bound)).rejects.toThrow(
    "WORKFLOW_DOWNLOAD_TARGET_REUSED",
  );
  expect(f.writes).toEqual([]);
});
it.each(["automatic", "collaborative"] as const)(
  "MCP parent workflow %s keeps all file steps and the original task",
  async (mode) => {
    const f = await setup(),
      signal = new AbortController().signal;
    const invoke = (method: string, params: unknown) =>
      f.core.invoke(f.principal, method, params, signal);
    const parent = await f.runtime.create(f.actor, {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      title: "parent",
      mode,
    });
    const bound = await bindings(f, parent.id);
    await f.authorize(parent.id);
    const preview = (await invoke("workflows.preview", {
      workflowId: f.saved.id,
      sessionId: f.sessionId,
      parentTaskId: parent.id,
      parameters: {},
      fileBindings: bound,
    })) as { id: string; plan: unknown[] };
    expect(preview.plan).toHaveLength(3);
    const run = (await invoke("workflows.run", {
      taskId: parent.id,
      previewId: preview.id,
      requestId: randomUUID(),
    })) as { id: string; stepCount: number };
    expect(run.stepCount).toBe(3);
    if (mode === "collaborative")
      for (const type of ["file.upload", "terminal.command", "file.download"])
        await approveNext(f, parent.id, type);
    await vi.waitFor(
      () =>
        expect(f.workflows.result(f.actor, parent.id, run.id).state).toBe(
          "completed",
        ),
      { timeout: 10000 },
    );
    const result = f.workflows.result(f.actor, parent.id, run.id);
    expect(result.operations.map((o) => o.actionType)).toEqual([
      "file.upload",
      "terminal.command",
      "file.download",
    ]);
    expect(await fs.readFile(f.destination)).toEqual(f.bytes);
    expect(f.runtime.list(f.human)).toHaveLength(1);
    expect(f.runtime.get(f.human, parent.id).state).toBe("ready");
    expect(JSON.stringify(preview)).not.toContain(f.folder);
  },
);
it("never continues a file failure with unknown commit, cleanup, audit gap or authorization loss", () => {
  const base = {
    status: "failed",
    action: { type: "file.download" },
    error: "FILE_NOT_FOUND",
  } as OperationView;
  expect(canContinueStepFailure(base)).toBe(true);
  for (const override of [
    { status: "unknown" },
    { auditGap: true },
    { error: "STALE_CONTROL" },
    { error: "POLICY_DENIED" },
    { fileResult: { commitMayHaveOccurred: true } },
    { fileResult: { temporaryPath: "/srv/.tmp" } },
    { fileResult: { transfer: { cleanupRequired: true } } },
  ])
    expect(
      canContinueStepFailure({ ...base, ...override } as OperationView),
    ).toBe(false);
});
it("uses one shared operation budget across file and command steps", async () => {
  const f = await setup(),
    t = await task(f),
    bound = await bindings(f, t.id);
  await authorize(f, t.id, bound, { maxOperations: 2 });
  await vi.waitFor(
    () => expect(f.runtime.get(f.human, t.id).state).toBe("paused-error"),
    { timeout: 10000 },
  );
  const view = f.runtime.get(f.human, t.id);
  expect(view.error).toBe("TASK_BUDGET_EXCEEDED");
  expect(
    view.operations
      .filter((o) => o.status === "succeeded")
      .map((o) => o.action.type),
  ).toEqual(["file.upload", "terminal.command"]);
  await expect(fs.stat(f.destination)).rejects.toThrow();
});
it("previews the actual file deny rule and refuses the entire plan before execution", async () => {
  const f = await setup();
  f.policy.sets.push({
    id: "deny-upload",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [],
    fileRules: [
      {
        id: "blocked",
        effect: "deny",
        reason: "只读服务器",
        match: { kind: "directory", path: "/srv", access: ["write"] },
      },
    ],
  });
  const preview = f.workflows.preview(f.actor, {
    workflowId: f.saved.id,
    sessionId: f.sessionId,
    parameters: {},
  });
  expect(preview.decisions[0].outcome).toBe("deny");
  expect(preview.decisions[1].outcome).not.toBe("deny");
  expect(() =>
    f.workflows.start(f.actor, preview.id, randomUUID(), "automatic"),
  ).toThrow("POLICY_DENIED");
  expect(f.writes).toEqual([]);
  expect(f.runtime.list(f.human)).toHaveLength(0);
});
