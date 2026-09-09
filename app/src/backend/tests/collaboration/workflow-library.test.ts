import { describe, it, expect, vi } from "vitest";
import { WorkflowLibrary } from "../../collaboration/workflows/library.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations.js";
import type { WorkflowDefinition } from "../../../types/workflow.js";
const human: TaskActor = { kind: "human", userId: "owner" };
const source: WorkflowDefinition = {
  schemaVersion: 1,
  id: "check",
  name: "巡检",
  version: "1.0.0",
  parameters: { message: { type: "string", default: "ready" } },
  defaults: { cwd: "/srv" },
  steps: [
    {
      id: "print",
      name: "输出",
      action: {
        type: "command",
        program: "printf",
        args: ["%s", { param: "message" }],
      },
    },
  ],
};
function fixture() {
  const storage = new Map<string, string>();
  const policy: CommandPolicySnapshot = { revision: 1, sets: [] };
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: () => {
        throw Error("PREVIEW_MUST_NOT_EXECUTE");
      },
    },
    () => {},
  );
  const tasks = new TaskRuntime({
    getSession: () => null,
    policy: async () => policy,
    audit: () => ({ append: async () => {}, record: async () => {} }),
  });
  const view: import("../../../types/collaboration-task.js").TaskView = {
    id: "task",
    sessionId: "session",
    hostId: 1,
    hostName: "fixture",
    title: "巡检",
    source: "workflow",
    mode: "automatic",
    state: "awaiting-authorization",
    nextStep: 0,
    stepCount: 1,
    commands: [],
    operations: [],
    control: control.snapshot(),
    policyRevision: 1,
    createdAt: Date.now(),
  };
  const create = vi
    .spyOn(tasks, "create")
    .mockImplementation(async (_actor, input) => ({
      ...view,
      ...input,
      source: "workflow",
      commands: input.commands ?? [],
    }));
  vi.spyOn(tasks, "get").mockReturnValue(view);
  const audit = vi.fn(async () => {});
  const library = new WorkflowLibrary({
    read: (user) => storage.get(user),
    write: async (user, value) => {
      storage.set(user, value);
    },
    ownsHost: async (user, host) => user === "owner" && host === 1,
    target: () => ({
      hostId: 1,
      groups: ["prod"],
      control: control.snapshot(),
    }),
    policy: () => policy,
    audit,
    tasks,
  });
  return {
    library,
    control,
    create,
    storage,
    policy,
    audit,
    save: () =>
      library.save("owner", { definition: source, allowedHostIds: [1] }),
  };
}
describe("workflow library immutable previews", () => {
  it("persists only owned definitions and rejects stale edits", async () => {
    const f = fixture(),
      saved = await f.save();
    expect(f.library.list("stranger")).toEqual([]);
    await expect(
      f.library.save("owner", {
        id: saved.id,
        expectedRevision: 0,
        definition: source,
        allowedHostIds: [1],
      }),
    ).rejects.toThrow("WORKFLOW_CHANGED");
    await expect(
      f.library.save("owner", { definition: source, allowedHostIds: [2] }),
    ).rejects.toThrow("HOST_NOT_FOUND");
    expect(f.create).not.toHaveBeenCalled();
  });
  it("serializes concurrent edits so only one matching revision wins", async () => {
    const f = fixture(),
      saved = await f.save();
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        f.library.save("owner", {
          id: saved.id,
          expectedRevision: saved.revision,
          definition: { ...source, name: "edit" + i },
          allowedHostIds: [1],
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.library.get("owner", saved.id).revision).toBe(2);
  });
  it("exports a definition without host bindings, credentials, or runtime parameters", async () => {
    const f = fixture(),
      saved = await f.save();
    const output = f.library.export("owner", saved.id);
    expect(output.definition).toEqual(source);
    expect(output).not.toHaveProperty("allowedHostIds");
    expect(output.warnings).toContain("CHECK_LITERAL_SECRETS");
    expect(f.library.inspectImport(output.definition).definition).toEqual(
      source,
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it("freezes run parameters, deduplicates start, and rejects changing its mode", async () => {
    const f = fixture(),
      saved = await f.save(),
      parameters = { message: "original" };
    const preview = f.library.preview(human, {
      workflowId: saved.id,
      sessionId: "session",
      parameters,
    });
    parameters.message = "changed";
    preview.commands[0].args[1] = "tampered";
    expect(f.create).not.toHaveBeenCalled();
    await f.library.start(human, preview.id, "request", "automatic");
    await f.library.start(human, preview.id, "request", "automatic");
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0][1]).toMatchObject({
      commands: [{ args: ["%s", "original"] }],
      workflow: { id: saved.id, revision: 1, shellState: "explicit-cwd" },
    });
    await expect(
      f.library.start(human, preview.id, "request", "collaborative"),
    ).rejects.toThrow("WORKFLOW_PREVIEW_USED");
  });
  it("rejects stale policy or control and previews from other actors", async () => {
    const f = fixture(),
      saved = await f.save();
    const preview = f.library.preview(human, {
      workflowId: saved.id,
      sessionId: "session",
      parameters: {},
    });
    await expect(
      f.library.start(
        { kind: "human", userId: "other" },
        preview.id,
        "r",
        "automatic",
      ),
    ).rejects.toThrow("WORKFLOW_PREVIEW_NOT_FOUND");
    f.policy.revision++;
    expect(() => f.library.start(human, preview.id, "r", "automatic")).toThrow(
      "POLICY_CHANGED",
    );
    f.policy.revision--;
    f.control.takeover();
    expect(() => f.library.start(human, preview.id, "r", "automatic")).toThrow(
      "STALE_CONTROL",
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it("invalidates a preview after changing or deleting its template", async () => {
    const f = fixture(),
      saved = await f.save();
    const preview = f.library.preview(human, {
      workflowId: saved.id,
      sessionId: "session",
      parameters: {},
    });
    const changed = await f.library.save("owner", {
      id: saved.id,
      expectedRevision: 1,
      definition: { ...source, version: "1.0.1" },
      allowedHostIds: [],
    });
    expect(() => f.library.start(human, preview.id, "r", "automatic")).toThrow(
      "WORKFLOW_CHANGED",
    );
    await f.library.remove("owner", saved.id, changed.revision);
    expect(f.library.list("owner")).toEqual([]);
  });
  it("does not persist changes when its audit fails", async () => {
    const f = fixture();
    f.audit.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.save()).rejects.toThrow("disk full");
    expect(f.library.list("owner")).toEqual([]);
  });
});

it("requires imported workflows to bind specific owned hosts before preview or execution", async () => {
  const f = fixture(),
    saved = await f.save();
  f.storage.set(
    "owner",
    JSON.stringify([{ ...saved, allowedHostIds: [], needsHostBinding: true }]),
  );
  expect(() =>
    f.library.preview(human, {
      workflowId: saved.id,
      sessionId: "session",
      parameters: {},
    }),
  ).toThrow("WORKFLOW_HOST_BINDING_REQUIRED");
  await expect(
    f.library.save("owner", {
      id: saved.id,
      expectedRevision: 1,
      definition: source,
      allowedHostIds: [],
    }),
  ).rejects.toThrow("WORKFLOW_HOST_BINDING_REQUIRED");
  const bound = await f.library.save("owner", {
    id: saved.id,
    expectedRevision: 1,
    definition: source,
    allowedHostIds: [1],
  });
  expect(bound.needsHostBinding).toBeUndefined();
  expect(
    f.library.preview(human, {
      workflowId: saved.id,
      sessionId: "session",
      parameters: {},
    }).commands,
  ).toHaveLength(1);
  expect(f.create).not.toHaveBeenCalled();
});
