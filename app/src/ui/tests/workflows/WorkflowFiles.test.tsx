import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import i18n from "../../i18n/i18n";
import { TaskAuthorizationForm } from "../../features/collaboration/TaskAuthorizationForm";
import { WorkflowDefinitionEditor } from "../../features/workflows/WorkflowDefinitionEditor";
import type { TaskView } from "../../../types/collaboration-task";
import type { HumanLocalFileGrant } from "../../../types/local-file-grants";
import type { WorkflowDefinition } from "../../../types/workflow";
const task: TaskView = {
  id: "task",
  sessionId: "session",
  hostId: 7,
  hostName: "服务器",
  title: "部署",
  source: "workflow",
  mode: "automatic",
  state: "awaiting-authorization",
  nextStep: 0,
  stepCount: 3,
  commands: [{ program: "pwd", args: [] }],
  plan: [
    {
      kind: "file-transfer",
      stepId: "up",
      name: "上传产物",
      direction: "upload",
      localFile: "artifact",
      path: "/srv/产物.bin",
      overwrite: false,
    },
    { program: "pwd", args: [] },
    {
      kind: "file-transfer",
      stepId: "down",
      name: "下载结果",
      direction: "download",
      localFile: "result",
      path: "/srv/产物.bin",
      overwrite: false,
    },
  ],
  operations: [],
  control: {
    sessionId: "session",
    generation: 1,
    controlEpoch: 1,
    controller: { kind: "human" },
    closed: false,
  },
  policyRevision: 1,
  createdAt: 1,
};
const grants: HumanLocalFileGrant[] = [
  {
    id: "upload",
    version: "v1",
    taskId: "task",
    direction: "upload",
    name: "产物.bin",
    path: "C:/本次/产物.bin",
    allowOverwrite: false,
    state: "active",
    createdAt: 1,
    expiresAt: Date.now() + 600000,
  },
  {
    id: "download",
    version: "v2",
    taskId: "task",
    direction: "download",
    name: "结果.bin",
    path: "C:/本次/结果.bin",
    allowOverwrite: false,
    state: "active",
    createdAt: 1,
    expiresAt: Date.now() + 600000,
  },
];
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
it("shows the full Chinese plan and submits selected IDs with explicit file scopes", () => {
  const authorize = vi.fn(async () => {});
  render(
    <TaskAuthorizationForm
      task={task}
      localGrants={grants}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  expect(screen.getByText(/上传文件 \/srv\/产物.bin/)).toBeTruthy();
  expect(screen.getByText(/下载文件 \/srv\/产物.bin/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已确认终端位于命令提示符/ }),
  );
  const button = screen.getByRole("button", {
    name: "授权并交还控制权",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(
    screen.getByRole("combobox", { name: "文件位置 · artifact" }),
    { target: { value: "upload" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "文件位置 · result" }),
    { target: { value: "download" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "填入剩余步骤的远端文件范围" }),
  );
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      fileBindings: {
        artifact: { localGrantId: "upload", localVersion: "v1" },
        result: { localGrantId: "download", localVersion: "v2" },
      },
      fileScopes: [
        { kind: "path", path: "/srv/产物.bin", access: ["write", "read"] },
      ],
    }),
  );
  expect(JSON.stringify(authorize.mock.calls)).not.toContain("C:/");
});
it("requires rebinding a revoked or changed file and omits completed upload slots on resume", () => {
  const authorize = vi.fn(async () => {}),
    bound = {
      artifact: { localGrantId: "upload", localVersion: "v1" },
      result: { localGrantId: "download", localVersion: "v2" },
    };
  const { rerender } = render(
    <TaskAuthorizationForm
      task={{ ...task, fileBindings: bound }}
      localGrants={grants}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已确认终端位于命令提示符/ }),
  );
  const button = screen.getByRole("button", {
    name: "授权并交还控制权",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  rerender(
    <TaskAuthorizationForm
      task={{ ...task, fileBindings: bound }}
      localGrants={[{ ...grants[0], state: "revoked" }, grants[1]]}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  expect(button.disabled).toBe(true);
  rerender(
    <TaskAuthorizationForm
      task={{ ...task, nextStep: 1, fileBindings: bound }}
      localGrants={[{ ...grants[0], state: "revoked" }, grants[1]]}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  expect(
    screen.queryByRole("combobox", { name: "文件位置 · artifact" }),
  ).toBeNull();
  expect(button.disabled).toBe(false);
  rerender(
    <TaskAuthorizationForm
      task={{ ...task, nextStep: 1, fileBindings: bound }}
      localGrants={[grants[0], { ...grants[1], version: "new" }]}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  expect(button.disabled).toBe(true);
});
it("creates upload and download steps in the Chinese editor without local paths", () => {
  let current: WorkflowDefinition = {
    schemaVersion: 1,
    id: "test",
    name: "流程",
    version: "1.0.0",
    parameters: {},
    defaults: {},
    steps: [
      {
        id: "one",
        name: "第一步",
        action: { type: "command", program: "pwd", args: [] },
      },
    ],
  };
  function Editor() {
    const [definition, setDefinition] = useState(current);
    return (
      <WorkflowDefinitionEditor
        definition={definition}
        onChange={(d) => {
          current = d;
          setDefinition(d);
        }}
      />
    );
  }
  render(<Editor />);
  const type = screen.getByRole("combobox", {
    name: i18n.t("tandem.workflow.actionType"),
  });
  fireEvent.change(type, { target: { value: "upload" } });
  expect(current.schemaVersion).toBe(2);
  expect(current.steps[0].action.type).toBe("upload");
  expect(screen.getByRole("textbox", { name: "远端文件路径" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "远端文件路径" }), {
    target: { value: "/srv/中文.zip" },
  });
  expect(current.steps[0].action).toMatchObject({
    path: "/srv/中文.zip",
    localFile: "upload_one",
  });
  fireEvent.change(type, { target: { value: "download" } });
  expect(current.files?.download_one.direction).toBe("download");
  expect(JSON.stringify(current)).not.toMatch(/localPath|localGrantId/);
});

it("edits directory actions and conflict choices without downgrading v3 when adding file slots", () => {
  let current: WorkflowDefinition = {
    schemaVersion: 1,
    id: "directory-editor",
    name: "目录流程",
    version: "1.0.0",
    parameters: {},
    defaults: {},
    steps: [
      {
        id: "one",
        name: "第一步",
        action: { type: "command", program: "pwd", args: [] },
      },
    ],
  };
  function Editor() {
    const [definition, setDefinition] = useState(current);
    return (
      <WorkflowDefinitionEditor
        definition={definition}
        onChange={(d) => {
          current = d;
          setDefinition(d);
        }}
      />
    );
  }
  render(<Editor />);
  const type = screen.getByRole("combobox", {
    name: i18n.t("tandem.workflow.actionType"),
  });
  fireEvent.change(type, { target: { value: "upload-directory" } });
  expect(current.schemaVersion).toBe(3);
  expect(current.steps[0].action.type).toBe("upload-directory");
  expect(current.files?.["upload-directory_one"]).toMatchObject({
    kind: "directory",
    direction: "upload",
  });
  fireEvent.change(screen.getByRole("combobox", { name: "目标文件冲突时" }), {
    target: { value: "overwrite" },
  });
  expect(current.steps[0].action).toMatchObject({
    type: "upload-directory",
    onConflict: "overwrite",
    overwrite: true,
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: i18n.t("tandem.workflow.fileOverwrite"),
    }),
  );
  expect(current.steps[0].action).toMatchObject({
    onConflict: "fail",
    overwrite: false,
  });
  fireEvent.change(
    screen.getByRole("textbox", {
      name: i18n.t("tandem.workflow.fileSlotName"),
    }),
    { target: { value: "extra" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("tandem.workflow.addFileSlot") }),
  );
  expect(current.files?.extra.kind).toBeUndefined();
  expect(current.schemaVersion).toBe(3);
  fireEvent.change(type, { target: { value: "download-directory" } });
  expect(current.files?.["download-directory_one"]).toMatchObject({
    kind: "directory",
    direction: "download",
  });
  expect(JSON.stringify(current)).not.toMatch(/localGrantId|localVersion|C:\//);
});
it("binds only directory grants and fills directory scopes for directory workflow steps", () => {
  const directoryTask: TaskView = {
    ...task,
    plan: task.plan!.map((s) =>
      "kind" in s
        ? {
            ...s,
            kind: "directory-transfer",
            path: "/srv/tree",
            onConflict: "fail",
          }
        : s,
    ),
  };
  const directoryGrants: HumanLocalFileGrant[] = grants.map((g) => ({
    ...g,
    id: g.id + "-dir",
    kind: "directory",
    name: "目录",
    path: "C:/本次/目录",
    entries: 4,
  }));
  const authorize = vi.fn(async () => {});
  render(
    <TaskAuthorizationForm
      task={directoryTask}
      localGrants={[...grants, ...directoryGrants]}
      disabled={false}
      revision={1}
      onAuthorize={authorize}
    />,
  );
  expect(screen.getByText(/上传目录 \/srv\/tree/)).toBeTruthy();
  const upload = screen.getByRole("combobox", {
    name: "文件位置 · artifact",
  }) as HTMLSelectElement;
  expect([...upload.options].some((o) => o.value === "upload")).toBe(false);
  fireEvent.change(upload, { target: { value: "upload-dir" } });
  fireEvent.change(
    screen.getByRole("combobox", { name: "文件位置 · result" }),
    { target: { value: "download-dir" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("tandem.workflow.addPlannedFileScopes"),
    }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已确认终端位于命令提示符/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "授权并交还控制权" }));
  expect(authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      fileBindings: {
        artifact: { localGrantId: "upload-dir", localVersion: "v1" },
        result: { localGrantId: "download-dir", localVersion: "v2" },
      },
      fileScopes: [
        { kind: "directory", path: "/srv/tree", access: ["write", "read"] },
      ],
    }),
  );
});
