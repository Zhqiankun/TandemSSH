import type { TaskAuthorization } from "../../../types/collaboration-task";
import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../collaboration/workflows/definition";
import type { WorkflowDefinition } from "../../../types/workflow";
import type { TaskFileBindings } from "../../../types/task-plan";
const definition: WorkflowDefinition = {
  schemaVersion: 3,
  id: "directory-deploy",
  name: "目录上传检查下载",
  version: "1.0.0",
  files: {
    artifact: { direction: "upload", kind: "directory" },
    result: { direction: "download", kind: "directory" },
  },
  parameters: {},
  defaults: { cwd: "/srv" },
  steps: [
    {
      id: "up",
      name: "上传目录",
      action: { type: "upload-directory", path: "/srv", localFile: "artifact" },
    },
    {
      id: "check",
      name: "核对",
      action: { type: "command", program: "pwd", args: [] },
    },
    {
      id: "down",
      name: "下载目录",
      action: {
        type: "download-directory",
        path: "/srv/bundle",
        localFile: "result",
      },
    },
  ],
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
async function setup(
  mode: "automatic" | "collaborative",
  conflict = false,
  sourceDefinition: WorkflowDefinition = definition,
) {
  const f = await transferToolsFixture();
  cleanup.push(f.close);
  const source = path.join(f.folder, "bundle"),
    destination = path.join(f.folder, "received");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.mkdir(path.join(source, "空目录"));
  await fs.writeFile(path.join(source, "data.bin"), f.bytes);
  await fs.writeFile(path.join(source, "empty.bin"), Buffer.alloc(0));
  if (conflict) {
    await f.remote.mkdir("/srv/bundle");
    await f.remote.write("/srv/bundle/data.bin", "old target");
  }
  const saved = await f.workflows.save("owner", {
      definition: sourceDefinition,
      allowedHostIds: [7],
    }),
    preview = f.workflows.preview(f.actor, {
      workflowId: saved.id,
      sessionId: f.sessionId,
      parameters: {},
    }),
    task = await f.workflows.start(f.actor, preview.id, randomUUID(), mode);
  const bindings: TaskFileBindings = {};
  for (const direction of ["upload", "download"] as const) {
    const ticket = f.grants.issue("owner", task.id, {
      windowToken: f.windowToken,
      direction,
      kind: "directory",
    });
    f.grants.claim(f.windowToken, ticket.id);
    const g = (
      await f.grants.fulfill(f.windowToken, ticket.id, [
        direction === "upload" ? source : destination,
      ])
    ).grants[0];
    bindings[direction === "upload" ? "artifact" : "result"] = {
      localGrantId: g.id,
      localVersion: g.version,
    };
  }
  const authorize = (extra: Partial<TaskAuthorization> = {}) =>
    f.runtime.authorize(f.human, task.id, {
      ...f.control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 20,
      durationMinutes: 10,
      allowReviewedPlan: true,
      fileScopes: [
        { kind: "directory", path: "/srv", access: ["read", "write"] },
      ],
      fileBindings: bindings,
      ...extra,
    });
  const approve = async () => {
    await vi.waitFor(
      () =>
        expect(f.runtime.get(f.human, task.id).state).toBe("awaiting-approval"),
      { timeout: 10000 },
    );
    const op = f.runtime.get(f.human, task.id).operations.at(-1)!;
    await f.runtime.approve(f.human, task.id, op.id, op.digest, 1);
    await vi.waitFor(
      () =>
        expect(f.runtime.operation(f.human, task.id, op.id).status).toBe(
          "succeeded",
        ),
      { timeout: 10000 },
    );
    return op;
  };
  const finish = async () => {
    if (mode === "collaborative")
      for (let i = 0; i < 20; i++) {
        await vi.waitFor(
          () =>
            expect(["awaiting-approval", "completed"]).toContain(
              f.runtime.state(f.human, task.id).state,
            ),
          { timeout: 10000 },
        );
        if (f.runtime.state(f.human, task.id).state === "completed") break;
        await approve();
      }
    await vi.waitFor(
      () => expect(f.runtime.state(f.human, task.id).state).toBe("completed"),
      { timeout: 10000 },
    );
  };
  return {
    ...f,
    task,
    source,
    destination,
    bindings,
    authorize,
    approve,
    finish,
  };
}
it("compiles v3 directory steps and rejects old versions, wrong slot kinds and implicit overwrite", () => {
  const compiled = compileWorkflow(definition, {});
  expect(compiled.plan.map((s) => ("kind" in s ? s.kind : "command"))).toEqual([
    "directory-transfer",
    "command",
    "directory-transfer",
  ]);
  expect(compiled.commands).toHaveLength(1);
  expect(JSON.stringify(compiled.plan)).not.toContain("localGrantId");
  expect(() => parseWorkflow({ ...definition, schemaVersion: 2 })).toThrow(
    "WORKFLOW_DIRECTORY_SCHEMA_REQUIRED",
  );
  expect(() =>
    parseWorkflow({
      ...definition,
      files: { ...definition.files, artifact: { direction: "upload" } },
    }),
  ).toThrow("WORKFLOW_FILE_SLOT_INVALID");
  const invalid = structuredClone(definition);
  invalid.steps[0].action = {
    type: "upload-directory",
    path: "/srv",
    localFile: "artifact",
    onConflict: "overwrite",
  };
  expect(() => parseWorkflow(invalid)).toThrow(
    "WORKFLOW_DIRECTORY_OVERWRITE_REQUIRED",
  );
});
it.each(["automatic", "collaborative"] as const)(
  "saved directory workflow uses the parent task in %s mode",
  async (mode) => {
    const f = await setup(mode);
    await f.authorize();
    await f.finish();
    const result = f.runtime.get(f.human, f.task.id);
    expect(result.stepCount).toBe(3);
    expect(result.nextStep).toBe(3);
    expect(result.operations).toHaveLength(13);
    expect(result.operations.map((o) => o.action.type)).toEqual([
      "file.directory.preview",
      "file.directory.confirm",
      ...Array(4).fill("file.directory.entry"),
      "terminal.command",
      "file.directory.preview",
      "file.directory.confirm",
      ...Array(4).fill("file.directory.entry"),
    ]);
    expect(
      await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
    ).toEqual(f.bytes);
    expect(
      await fs.readdir(path.join(f.destination, "bundle", "空目录")),
    ).toEqual([]);
    expect(f.writes).toEqual(["context", "pwd"]);
    expect(
      f.directoryAutomation.previews(f.human, f.task.id).every((p) => !p.inUse),
    ).toBe(true);
  },
  30000,
);
it("preserves completed directory entries when human takeover interrupts the first workflow step", async () => {
  const f = await setup("collaborative");
  await f.authorize();
  await f.approve();
  await f.approve();
  const first = await f.approve();
  expect(first.action.type).toBe("file.directory.entry");
  f.runtime.takeover(f.human, f.sessionId);
  await vi.waitFor(() =>
    expect(f.runtime.state(f.human, f.task.id).state).toBe("paused-human"),
  );
  expect(f.runtime.get(f.human, f.task.id).nextStep).toBe(0);
  const preview = f.directoryAutomation.previews(f.human, f.task.id)[0];
  expect(preview.inUse).toBe(true);
  await expect(
    f.directoryAutomation.release(f.human, f.task.id, preview.id),
  ).rejects.toThrow("DIRECTORY_IN_PROGRESS");
  await f.authorize();
  await f.finish();
  const operations = f.runtime.get(f.human, f.task.id).operations;
  expect(
    operations.filter(
      (o) =>
        o.action.type === "file.directory.entry" &&
        o.action.path === "/srv/bundle" &&
        o.action.direction === "upload" &&
        o.status === "succeeded",
    ),
  ).toHaveLength(1);
  expect(
    await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
  ).toEqual(f.bytes);
  expect(f.writes).toEqual(["context", "context", "pwd"]);
}, 30000);
it("stops on an unapproved conflict and releases a cancelled workflow's manifest reservation", async () => {
  const f = await setup("automatic", true);
  await f.authorize();
  await vi.waitFor(
    () =>
      expect(f.runtime.state(f.human, f.task.id).state).toBe("paused-error"),
    { timeout: 10000 },
  );
  const task = f.runtime.get(f.human, f.task.id);
  expect(task.operations.at(-1)?.error).toBe("DIRECTORY_CONFLICT");
  expect(await f.remote.read("/srv/bundle/data.bin")).toEqual(
    Buffer.from("old target"),
  );
  expect(f.writes).toEqual(["context"]);
  const preview = f.directoryAutomation.previews(f.human, f.task.id)[0];
  expect(preview.inUse).toBe(true);
  f.runtime.cancel(f.human, f.task.id);
  expect(f.directoryAutomation.previews(f.human, f.task.id)[0].inUse).toBe(
    false,
  );
  await f.directoryAutomation.release(f.human, f.task.id, preview.id);
}, 30000);

it("rebuilds a failed confirmation preview after the target conflict is resolved", async () => {
  const f = await setup("automatic", true);
  await f.authorize();
  await vi.waitFor(
    () =>
      expect(f.runtime.state(f.human, f.task.id).state).toBe("paused-error"),
    { timeout: 10000 },
  );
  const old = f.directoryAutomation.previews(f.human, f.task.id)[0];
  await new Promise<void>((resolve, reject) =>
    f.remote.client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      sftp.unlink("/srv/bundle/data.bin", (error) => {
        sftp.end();
        if (error) reject(error);
        else resolve();
      });
    }),
  );
  await f.authorize({ reconciliation: "retry" });
  await f.finish();
  expect(
    f.runtime
      .get(f.human, f.task.id)
      .operations.filter(
        (o) =>
          o.action.type === "file.directory.preview" &&
          o.action.direction === "upload",
      ),
  ).toHaveLength(2);
  expect(
    f.directoryAutomation
      .previews(f.human, f.task.id)
      .find((p) => p.id === old.id)?.inUse,
  ).toBe(false);
  expect(() =>
    f.directoryTransfers.retain(
      f.runtime.fileObservationContext(f.human, f.task.id),
      old.id,
    ),
  ).toThrow("DIRECTORY_PREVIEW_USED");
  expect(
    await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
  ).toEqual(f.bytes);
}, 30000);
it("does not switch the local directory binding after entries have already executed", async () => {
  const f = await setup("collaborative");
  await f.authorize();
  await f.approve();
  await f.approve();
  await f.approve();
  f.runtime.takeover(f.human, f.sessionId);
  const replacement = path.join(f.folder, "replacement");
  await fs.mkdir(replacement);
  const ticket = f.grants.issue("owner", f.task.id, {
    windowToken: f.windowToken,
    direction: "upload",
    kind: "directory",
  });
  f.grants.claim(f.windowToken, ticket.id);
  const grant = (
      await f.grants.fulfill(f.windowToken, ticket.id, [replacement])
    ).grants[0],
    original = f.bindings.artifact;
  f.bindings.artifact = { localGrantId: grant.id, localVersion: grant.version };
  await expect(f.authorize()).rejects.toThrow(
    "WORKFLOW_DIRECTORY_BINDING_LOCKED",
  );
  expect(f.control.snapshot().controller.kind).toBe("human");
  f.bindings.artifact = original;
  await f.authorize();
  await f.finish();
  expect(
    await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
  ).toEqual(f.bytes);
}, 30000);
it("continues an explicitly allowed conflict failure but reports the workflow with errors", async () => {
  const source = structuredClone(definition);
  source.steps[0].onFailure = "continue";
  const f = await setup("automatic", true, source);
  await f.authorize();
  await vi.waitFor(
    () =>
      expect(f.runtime.state(f.human, f.task.id).state).toBe(
        "completed-with-errors",
      ),
    { timeout: 10000 },
  );
  expect(
    await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
  ).toEqual(Buffer.from("old target"));
  expect(f.writes).toEqual(["context", "pwd"]);
  expect(f.runtime.get(f.human, f.task.id).hasFailures).toBe(true);
}, 30000);
it("does not continue past a blocked directory entry even with continue-on-failure configured", async () => {
  const source = structuredClone(definition);
  source.steps[0].onFailure = "continue";
  const f = await setup("automatic", false, source);
  f.policy.revision = 2;
  f.policy.sets.push({
    id: "blocked-file",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [],
    fileRules: [
      {
        id: "deny-data",
        effect: "deny",
        match: {
          kind: "path",
          path: "/srv/bundle/data.bin",
          access: ["write"],
        },
        reason: "Forbidden target",
      },
    ],
  });
  await f.authorize({ policyRevision: 2 });
  await vi.waitFor(
    () =>
      expect(f.runtime.state(f.human, f.task.id).state).toBe("paused-error"),
    { timeout: 10000 },
  );
  expect(f.runtime.get(f.human, f.task.id).operations.at(-1)?.error).toBe(
    "DIRECTORY_BLOCKED",
  );
  expect(f.writes).toEqual(["context"]);
  await expect(f.remote.read("/srv/bundle/data.bin")).rejects.toThrow();
}, 30000);

it("stops at the parent budget and resumes without repeating the completed directory", async () => {
  const f = await setup("automatic");
  await f.authorize({ maxOperations: 3 });
  await vi.waitFor(
    () =>
      expect(f.runtime.get(f.human, f.task.id).error).toBe(
        "TASK_BUDGET_EXCEEDED",
      ),
    { timeout: 10000 },
  );
  const before = f.runtime.get(f.human, f.task.id);
  expect(
    before.operations.filter((o) => o.status === "succeeded"),
  ).toHaveLength(3);
  expect(f.writes).toEqual(["context"]);
  await expect(f.remote.read("/srv/bundle/data.bin")).rejects.toThrow();
  await f.authorize();
  await f.finish();
  expect(
    f.runtime
      .get(f.human, f.task.id)
      .operations.filter(
        (o) =>
          o.action.type === "file.directory.entry" &&
          o.action.direction === "upload" &&
          o.action.path === "/srv/bundle" &&
          o.status === "succeeded",
      ),
  ).toHaveLength(1);
  expect(
    await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
  ).toEqual(f.bytes);
}, 30000);

it("reuses a directory download grant for distinct directory steps without changing its root", async () => {
  const source = structuredClone(definition);
  source.steps = [
    source.steps[0],
    source.steps[2],
    {
      id: "download-empty",
      name: "下载空目录",
      action: {
        type: "download-directory",
        path: "/srv/bundle/空目录",
        localFile: "result",
      },
    },
  ];
  const f = await setup("automatic", false, source);
  await f.authorize();
  await f.finish();
  expect(await fs.readdir(path.join(f.destination, "空目录"))).toEqual([]);
  expect(
    await fs.readdir(path.join(f.destination, "bundle", "空目录")),
  ).toEqual([]);
  expect(
    f.runtime
      .get(f.human, f.task.id)
      .operations.filter(
        (o) =>
          o.action.type === "file.directory.preview" &&
          o.action.direction === "download",
      ),
  ).toHaveLength(2);
}, 30000);
