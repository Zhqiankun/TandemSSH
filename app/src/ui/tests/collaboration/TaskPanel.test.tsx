import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  TaskRuntime,
  type TaskActor,
} from "../../../backend/collaboration/tasks/runtime";
import { SessionControl } from "../../../backend/collaboration/sessions/control";
import i18n from "../../i18n/i18n";
const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  taskPage: vi.fn(),
  create: vi.fn(),
  authorize: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  takeover: vi.fn(),
}));
vi.mock("@/api/collaboration-api", () => ({
  collaborationApi: api,
  collaborationErrorCode: () => "STALE_CONTROL",
}));
vi.mock("@/api/directory-transfer-api", () => ({
  directoryTransferApi: {
    snapshot: vi.fn(async () => ({ previews: [], runs: [] })),
  },
}));
vi.mock("@/features/mcp/McpSettings", () => ({ McpSettings: () => null }));
import { TaskPanel } from "../../features/collaboration/TaskPanel";
let runtime: TaskRuntime, control: SessionControl;
const actor: TaskActor = { kind: "human", userId: "test-user" };
let writes: string[];
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  writes = [];
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
  // This test puts browser and Node code in one jsdom realm; fixture bytes must use that realm's Uint8Array. Production HTTP transports keep those realms separate.
  const session = {
    id: "session",
    userId: "test-user",
    hostId: 1,
    hostName: "test@localhost:22",
    groups: () => [],
    files: {
      prepare: async (action: { path: string }) => ({
        execute: async (guard: (path?: string) => void) => {
          guard(action.path);
          return { status: "succeeded" as const, result: { bytes: 42 } };
        },
        dispose: () => {},
      }),
    },
    control,
    executor: {
      prepareContext: () => ({
        bytes: Uint8Array.from(Buffer.from("context")),
        completion: Promise.resolve({ exitCode: 0, output: "", cwd: "/srv" }),
        dispose: () => {},
      }),
      prepare: async (action: { program: string }) => ({
        bytes: Uint8Array.from(Buffer.from(action.program)),
        completion: Promise.resolve({
          exitCode: 0,
          output: "执行输出 " + action.program,
          cwd: "/srv",
        }),
        dispose: () => {},
      }),
    },
  };
  runtime = new TaskRuntime({
    getSession: () => session,
    policy: async () => ({ revision: 1, sets: [] }),
    audit: () => ({ append: async () => {}, record: async () => {} }),
  });
  api.snapshot.mockImplementation(async () => ({
    tasks: runtime.list(actor),
    session: {
      id: "session",
      hostId: 1,
      hostName: session.hostName,
      connected: true,
      control: control.snapshot(),
    },
    policy: { revision: 1, sets: [] },
  }));
  api.create.mockImplementation((input) => runtime.create(actor, input));
  api.authorize.mockImplementation((id, input) =>
    runtime.authorize(actor, id, input),
  );
  api.approve.mockImplementation((id, input) =>
    runtime.approve(
      actor,
      id,
      input.operationId,
      input.digest,
      input.policyRevision,
      input.fileReviewId,
    ),
  );
  api.cancel.mockImplementation((id) => runtime.cancel(actor, id));
  api.takeover.mockImplementation(async () =>
    runtime.takeover(actor, "session"),
  );
});
afterEach(() => {
  cleanup();
  control.close();
});
async function createPlan(automatic = false) {
  render(<TaskPanel sessionId="session" onClose={() => {}} />);
  await screen.findByText("你持有控制权");
  if (automatic)
    fireEvent.click(screen.getByRole("radio", { name: /自动执行/ }));
  fireEvent.click(screen.getByRole("button", { name: "检查计划与授权" }));
  await screen.findByText("本次任务授权");
}
function authorize() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已确认终端位于命令提示符/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "授权并交还控制权" }));
}
describe("Chinese workbench wired to the actual task runtime", () => {
  it("requires the shell acknowledgment then approves and shows each real service step", async () => {
    await createPlan();
    expect(
      (
        screen.getByRole("button", {
          name: "授权并交还控制权",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    authorize();
    await screen.findByRole("button", { name: "确认执行这一条" });
    expect(writes).toEqual(["context"]);
    for (const program of ["pwd", "df", "uptime"]) {
      fireEvent.click(
        await screen.findByRole("button", { name: "确认执行这一条" }),
      );
      await waitFor(() => expect(writes).toContain(program));
    }
    await screen.findByText("已完成");
    expect(writes).toEqual(["context", "pwd", "df", "uptime"]);
    expect(api.approve).toHaveBeenCalledTimes(3);
    expect(screen.getByText("执行输出 pwd")).toBeTruthy();
  });
  it("runs the automatic plan after one bounded task authorization", async () => {
    await createPlan(true);
    authorize();
    await screen.findByText("已完成");
    expect(writes).toEqual(["context", "pwd", "df", "uptime"]);
    expect(api.approve).not.toHaveBeenCalled();
    expect(api.authorize.mock.calls[0][1]).toMatchObject({
      maxOperations: 10,
      durationMinutes: 15,
      shellReady: true,
      allowReviewedPlan: false,
    });
  });
  it("keeps takeover clickable while the authorization request is pending", async () => {
    await createPlan();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.authorize.mockImplementation(async (id, input) => {
      await pending;
      return runtime.authorize(actor, id, input);
    });
    authorize();
    await waitFor(() => expect(api.authorize).toHaveBeenCalled());
    const button = screen.getByRole("button", { name: "立即接管" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.takeover).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(writes).toEqual([]));
  });
});

describe("parent workflow in the Chinese task panel", () => {
  it("shows flow provenance and sends the displayed plan revision for authorization", async () => {
    const parent = await runtime.create(actor, {
      sessionId: "session",
      requestId: "flow-parent",
      title: "父任务",
      mode: "automatic",
    });
    await runtime.attachWorkflow(actor, parent.id, {
      requestId: "child",
      name: "保存的巡检",
      workflow: {
        id: "template",
        revision: 3,
        version: "1.2.0",
        shellState: "explicit-cwd",
      },
      commands: [{ program: "pwd", args: [] }],
      expectedControl: control.snapshot(),
    });
    render(
      <TaskPanel
        sessionId="session"
        focusTaskId={parent.id}
        onClose={() => {}}
      />,
    );
    await screen.findByText("流程：保存的巡检");
    await screen.findByText(/版本 1.2.0 · 修订 3/);
    authorize();
    await waitFor(() =>
      expect(runtime.get(actor, parent.id).workflowRuns?.[0].state).toBe(
        "completed",
      ),
    );
    expect(api.authorize.mock.calls[0][1].planRevision).toBe(1);
    expect(control.snapshot().controller.kind).toBe("automation");
    await screen.findByText(/流程已结束，父任务保留控制权继续处理/);
  });
});

it("sends only explicitly chosen file access with the task authorization", async () => {
  await createPlan(true);
  fireEvent.click(screen.getByRole("button", { name: "添加文件范围" }));
  fireEvent.change(screen.getByLabelText("绝对路径"), {
    target: { value: "/srv/config" },
  });
  fireEvent.change(screen.getByLabelText("匹配范围"), {
    target: { value: "directory" },
  });
  fireEvent.change(screen.getByLabelText("文件权限"), {
    target: { value: "both" },
  });
  authorize();
  await screen.findByText("已完成");
  expect(api.authorize.mock.calls[0][1].fileScopes).toEqual([
    { kind: "directory", path: "/srv/config", access: ["read", "write"] },
  ]);
});

it("shows a file outcome in Chinese without inventing a terminal exit code", async () => {
  const fileActor: TaskActor = {
    kind: "mcp",
    userId: "test-user",
    clientId: "file-ui",
    connectionId: "file-ui-connection",
    allowedHostIds: [1],
  };
  runtime.connectClient(fileActor.connectionId);
  const task = await runtime.create(fileActor, {
    sessionId: "session",
    requestId: "file-ui",
    title: "文件检查",
    mode: "automatic",
  });
  render(
    <TaskPanel sessionId="session" focusTaskId={task.id} onClose={() => {}} />,
  );
  await screen.findByText("本次任务授权");
  fireEvent.click(screen.getByRole("button", { name: "添加文件范围" }));
  fireEvent.change(screen.getByLabelText("绝对路径"), {
    target: { value: "/srv/config" },
  });
  authorize();
  await waitFor(() => expect(runtime.get(actor, task.id).state).toBe("ready"));
  await runtime.submitFile(
    fileActor,
    task.id,
    { type: "file.read", path: "/srv/config" },
    "file-read",
  );
  await screen.findByText("读取文件 /srv/config");
  await screen.findByText("已处理 42 字节");
  expect(screen.queryByText(/退出码/)).toBeNull();
  expect(writes).toEqual(["context"]);
});

it("creates a directory task without a command plan and leaves it awaiting scope authorization", async () => {
  render(<TaskPanel sessionId="session" onClose={() => {}} />);
  await screen.findByText("你持有控制权");
  fireEvent.click(screen.getByRole("button", { name: "目录传输" }));
  expect(screen.queryByRole("textbox", { name: "命令计划" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "检查计划与授权" }));
  await screen.findByText("本次任务授权");
  expect(api.create.mock.lastCall?.[0].commands).toBeUndefined();
  const task = runtime.list(actor).at(-1)!;
  expect(task.stepCount).toBe(0);
  expect(task.state).toBe("awaiting-authorization");
  expect(writes).toEqual([]);
});

it("pages long operation history and keeps the latest results easy to reach", async () => {
  const created = await runtime.create(actor, {
    sessionId: "session",
    requestId: "long-history",
    title: "长任务",
    mode: "automatic",
    commands: Array.from({ length: 55 }, (_, i) => ({
      program: "printf",
      args: [String(i)],
    })),
  });
  await runtime.authorize(actor, created.id, {
    ...control.snapshot(),
    policyRevision: 1,
    shellReady: true,
    maxOperations: 60,
    durationMinutes: 10,
    allowReviewedPlan: true,
  });
  await vi.waitFor(() =>
    expect(runtime.get(actor, created.id).state).toBe("completed"),
  );
  const view = render(
    <TaskPanel
      sessionId="session"
      focusTaskId={created.id}
      onClose={() => {}}
    />,
  );
  await screen.findByRole("navigation", { name: "任务操作记录分页" });
  expect(view.container.querySelectorAll(".tandem-operation")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(view.container.querySelectorAll(".tandem-operation")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "前往最新记录" }));
  expect(view.container.querySelectorAll(".tandem-operation")).toHaveLength(5);
});

it("waits for the selected directory plan before initializing authorization defaults", async () => {
  const task = await runtime.create(actor, {
    sessionId: "session",
    requestId: "paged-directory-form",
    title: "分页目录任务",
    mode: "automatic",
    plan: [
      {
        kind: "directory-transfer",
        stepId: "dir",
        name: "目录",
        direction: "upload",
        path: "/srv",
        localFile: "folder",
        overwrite: false,
        onConflict: "fail",
      },
    ],
  });
  const original = api.snapshot.getMockImplementation()!;
  api.snapshot.mockImplementation(async () => ({
    ...(await original()),
    tasks: runtime.list(actor, undefined, { operationLimit: 0 }),
  }));
  let resolve!: (value: ReturnType<TaskRuntime["get"]>) => void;
  api.taskPage.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(
    <TaskPanel sessionId="session" focusTaskId={task.id} onClose={() => {}} />,
  );
  await waitFor(() => expect(api.taskPage).toHaveBeenCalled());
  expect(screen.queryByText("本次任务授权")).toBeNull();
  resolve(runtime.get(actor, task.id, { operationLimit: 50 }));
  await screen.findByText("本次任务授权");
  expect(
    (
      screen.getByRole("spinbutton", {
        name: i18n.t("tandem.collaboration.maxOperations"),
      }) as HTMLInputElement
    ).value,
  ).toBe("100");
});
