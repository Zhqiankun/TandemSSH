import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { WorkflowLibrary as Library } from "../../../backend/collaboration/workflows/library";
import { TaskRuntime } from "../../../backend/collaboration/tasks/runtime";
import { SessionControl } from "../../../backend/collaboration/sessions/control";
import type { WorkflowDefinition } from "../../../types/workflow";
import i18n from "../../i18n/i18n";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn(),
  export: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
}));
const collab = vi.hoisted(() => ({ targets: vi.fn(), takeover: vi.fn() }));
vi.mock("@/api/workflow-api", () => ({
  workflowApi: api,
  workflowError: (e: Error) => ({ code: e.message }),
}));
vi.mock("@/api/collaboration-api", () => ({ collaborationApi: collab }));
import { WorkflowLibraryBody } from "../../features/workflows/WorkflowLibrary";
const actor = { kind: "human" as const, userId: "owner" };
const template: WorkflowDefinition = {
  schemaVersion: 1,
  id: "check",
  name: "发布检查",
  version: "1.0.0",
  parameters: { message: { type: "string", required: true, default: "hello" } },
  defaults: { cwd: "/srv" },
  steps: [
    {
      id: "one",
      name: "显示参数",
      action: {
        type: "command",
        program: "printf",
        args: ["%s", { param: "message" }],
      },
    },
    {
      id: "two",
      name: "检查目录",
      action: { type: "command", program: "pwd", args: [] },
    },
  ],
};
let policy: import("../../../types/collaboration-operations").CommandPolicySnapshot;
let library: Library,
  runtime: TaskRuntime,
  control: SessionControl,
  writes: string[],
  created: ReturnType<
    typeof vi.fn<
      (task: import("../../../types/collaboration-task").TaskView) => void
    >
  >;
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  writes = [];
  created = vi.fn();
  control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: (bytes) => {
        writes.push(Buffer.from(bytes).toString());
      },
    },
    () => {},
  );
  policy = { revision: 1, sets: [] };
  const session = {
    id: "session",
    userId: "owner",
    hostId: 1,
    hostName: "Fixture",
    groups: () => [],
    control,
    executor: {
      prepareContext: () => ({
        bytes: Uint8Array.from(Buffer.from("context")),
        completion: Promise.resolve({ exitCode: 0, output: "", cwd: "/srv" }),
        dispose: () => {},
      }),
      prepare: async () => ({
        bytes: Uint8Array.from(Buffer.from("command")),
        completion: Promise.resolve({
          exitCode: 0,
          output: "done",
          cwd: "/srv",
        }),
        dispose: () => {},
      }),
    },
  };
  runtime = new TaskRuntime({
    getSession: () => session,
    policy: async () => policy,
    audit: () => ({ append: async () => {}, record: async () => {} }),
  });
  let storage: string | undefined;
  library = new Library({
    read: () => storage,
    write: async (_, value) => {
      storage = value;
    },
    ownsHost: async (_, id) => id === 1,
    target: () => ({ hostId: 1, groups: [], control: control.snapshot() }),
    policy: () => policy,
    audit: async () => {},
    tasks: runtime,
  });
  await library.save("owner", { definition: template, allowedHostIds: [1] });
  api.list.mockImplementation(async () => library.list("owner"));
  api.save.mockImplementation((input) => library.save("owner", input));
  api.inspect.mockImplementation(async (input) => library.inspectImport(input));
  api.export.mockImplementation(async (id) => library.export("owner", id));
  api.preview.mockImplementation(async (id, sessionId, parameters) =>
    library.preview(actor, { workflowId: id, sessionId, parameters }),
  );
  api.start.mockImplementation((preview, request, mode) =>
    library.start(actor, preview, request, mode),
  );
  api.remove.mockImplementation((row) =>
    library.remove("owner", row.id, row.revision),
  );
  collab.targets.mockResolvedValue([
    { id: 1, name: "Fixture", address: "127.0.0.1", port: 22, groups: [] },
  ]);
  collab.takeover.mockImplementation(async () => control.takeover());
});
afterEach(() => {
  cleanup();
  control.close();
});
async function open() {
  render(
    <WorkflowLibraryBody
      sessionId="session"
      hostId={1}
      connected
      onCreated={created}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /发布检查/ }));
}
describe("Chinese workflow UI connected to the real library and task runtime", () => {
  it.each(["collaborative", "automatic"])(
    "previews exact parameters then creates an unauthorized %s task",
    async (mode) => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "参数与运行" }));
      const payload = "release; $(printf extra) '中文'";
      fireEvent.change(screen.getByLabelText(/^message/), {
        target: { value: payload },
      });
      fireEvent.change(screen.getByLabelText("运行方式"), {
        target: { value: mode },
      });
      fireEvent.click(screen.getByRole("button", { name: "生成运行预览" }));
      await screen.findByText("检查展开后的执行步骤");
      expect(writes).toEqual([]);
      expect(api.start).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "创建任务并前往授权" }),
      );
      await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
      const task = created.mock.calls[0][0];
      expect(task).toMatchObject({
        mode,
        state: "awaiting-authorization",
        commands: [{ args: ["%s", payload] }, { program: "pwd" }],
      });
      expect(writes).toEqual([]);
      expect(runtime.get(actor, task.id).workflow?.revision).toBe(1);
    },
  );
  it("invalidates the visible preview immediately after parameter edits", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "参数与运行" }));
    fireEvent.click(screen.getByRole("button", { name: "生成运行预览" }));
    await screen.findByRole("button", { name: "创建任务并前往授权" });
    fireEvent.change(screen.getByLabelText(/^message/), {
      target: { value: "changed" },
    });
    expect(
      screen.queryByRole("button", { name: "创建任务并前往授权" }),
    ).toBeNull();
    expect(api.start).not.toHaveBeenCalled();
  });
  it("does not broaden host scope when the last selected host is unchecked", async () => {
    await open();
    const host = screen.getByRole("checkbox", {
      name: /Fixture/,
    }) as HTMLInputElement;
    fireEvent.click(host);
    expect(host.checked).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "允许本用户的全部服务器",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    await screen.findByText(/至少选择一台主机/);
  });
  it("saves graphical edits without executing and retains optimistic revision checks", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("流程名称"), {
      target: { value: "发布前巡检" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));
    await screen.findByText("流程已保存，未执行命令。");
    expect(library.list("owner")[0]).toMatchObject({
      revision: 2,
      definition: { name: "发布前巡检" },
    });
    expect(api.save.mock.calls[0][0].expectedRevision).toBe(1);
    expect(writes).toEqual([]);
    expect(api.start).not.toHaveBeenCalled();
  });
  it("requires export review and does not include runtime or host bindings", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    const download = (await screen.findByRole("button", {
      name: "下载流程 JSON",
    })) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查以下 JSON/ }),
    );
    expect(download.disabled).toBe(false);
    const exported = library.export("owner", library.list("owner")[0].id);
    expect(exported.definition).toEqual(template);
    expect(exported).not.toHaveProperty("allowedHostIds");
    expect(api.start).not.toHaveBeenCalled();
  });
  it("inspects an imported file and requires human review before saving it", async () => {
    await open();
    const input = new File(
      [JSON.stringify({ ...template, name: "导入的巡检" })],
      "workflow.json",
      { type: "application/json" },
    );
    Object.defineProperty(input, "text", {
      value: async () => JSON.stringify({ ...template, name: "导入的巡检" }),
    });
    fireEvent.change(screen.getByLabelText("导入流程文件"), {
      target: { files: [input] },
    });
    const save = (await screen.findByRole("button", {
      name: "确认保存导入流程",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查导入的步骤/ }),
    );
    fireEvent.click(save);
    await screen.findByText("流程已保存，未执行命令。");
    expect(library.list("owner")).toHaveLength(2);
    expect(writes).toEqual([]);
  });
});

describe("enum input fidelity", () => {
  it("keeps an explicit empty enum choice distinct from the default", async () => {
    const saved = library.list("owner")[0],
      definition = structuredClone(saved.definition);
    definition.parameters.choice = {
      type: "enum",
      values: ["", "release"],
      default: "release",
    };
    const firstAction = definition.steps[0].action;
    if (firstAction.type !== "command") throw Error("Expected command fixture");
    firstAction.args.push({ param: "choice" });
    await library.save("owner", {
      id: saved.id,
      expectedRevision: saved.revision,
      definition,
      allowedHostIds: [1],
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "参数与运行" }));
    fireEvent.change(screen.getByLabelText(/^choice/), {
      target: { value: "value:" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成运行预览" }));
    await screen.findByText("检查展开后的执行步骤");
    expect(api.preview.mock.calls[0][2].choice).toBe("");
    const preview = await api.preview.mock.results[0].value;
    expect(preview.commands[0].args.at(-1)).toBe("");
  });
});

describe("export download lifecycle", () => {
  it("attaches the download link and cleans it up after activation", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    const download = await screen.findByRole("button", {
      name: "下载流程 JSON",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查以下 JSON/ }),
    );
    const OriginalURL = URL;
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(class extends OriginalURL {}, {
        createObjectURL: vi.fn(() => "blob:workflow-test"),
        revokeObjectURL: revoke,
      }),
    );
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.isConnected).toBe(true);
        expect(this.download).toBe("check-1.0.0.json");
      });
    try {
      vi.useFakeTimers();
      fireEvent.click(download);
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(
        document.querySelector('a[download="check-1.0.0.json"]'),
      ).not.toBeNull();
      vi.advanceTimersByTime(1001);
      expect(
        document.querySelector('a[download="check-1.0.0.json"]'),
      ).toBeNull();
      expect(revoke).toHaveBeenCalledWith("blob:workflow-test");
    } finally {
      vi.useRealTimers();
      clicked.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

it("keeps a human-started workflow subject to a hard deny rule", async () => {
  policy.sets = [
    {
      id: "deny",
      scope: { type: "global" },
      strictAllowlist: false,
      rules: [
        {
          id: "deny-printf",
          effect: "deny",
          match: { kind: "program", program: "printf" },
          reason: "禁止该命令",
        },
      ],
    },
  ];
  await open();
  fireEvent.click(screen.getByRole("button", { name: "参数与运行" }));
  fireEvent.click(screen.getByRole("button", { name: "生成运行预览" }));
  const start = await screen.findByRole("button", {
    name: "创建任务并前往授权",
  });
  expect(start.hasAttribute("disabled")).toBe(true);
  fireEvent.click(start);
  expect(api.start).not.toHaveBeenCalled();
  expect(runtime.list(actor)).toEqual([]);
  expect(writes).toEqual([]);
});
it("rejects a human start when the policy changed after the displayed preview", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "参数与运行" }));
  fireEvent.click(screen.getByRole("button", { name: "生成运行预览" }));
  const start = await screen.findByRole("button", {
    name: "创建任务并前往授权",
  });
  policy.revision++;
  fireEvent.click(start);
  await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
  await screen.findByRole("alert");
  expect(created).not.toHaveBeenCalled();
  expect(runtime.list(actor)).toEqual([]);
  expect(writes).toEqual([]);
});
