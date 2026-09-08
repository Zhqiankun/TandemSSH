import { LegacyCommandService } from "../../collaboration/legacy/service.js";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpCore } from "../../mcp/core.js";
import { createTandemMcpServer } from "../../mcp/server.js";
import { WorkflowLibrary } from "../../collaboration/workflows/library.js";
import { TaskRuntime } from "../../collaboration/tasks/runtime.js";
import * as pty from "node-pty";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionControl } from "../../collaboration/sessions/control.js";
import {
  PtyCommandExecutor,
  quoteShellWord,
} from "../../collaboration/adapters/pty-command.js";
import { OperationGateway } from "../../collaboration/operations/gateway.js";
import type { CommandAction } from "../../../types/collaboration-operations.js";

const shell =
  process.env.TANDEM_TEST_BASH ??
  (process.platform === "win32" ? "" : "/bin/bash");
const windowsToPosix = (value: string) =>
  process.platform === "win32"
    ? value
        .replace(/\\/g, "/")
        .replace(
          /^([A-Za-z]):/,
          (_, drive: string) => `/${drive.toLowerCase()}`,
        )
    : value;

async function withTerminal(
  test: (context: {
    control: SessionControl;
    executor: PtyCommandExecutor;
    root: string;
    child: string;
  }) => Promise<void>,
  sessionId = "real-pty",
) {
  const workspace = fs.realpathSync(
    fileURLToPath(new URL("../../../../../", import.meta.url)),
  );
  const base = path.join(workspace, ".cache", "pty-tests");
  fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, "session-"));
  const childFolder = path.join(folder, "子目录 ' quoted");
  fs.mkdirSync(childFolder);
  const output = new EventEmitter();
  let closed = false;
  const terminal = pty.spawn(shell, ["--noprofile", "--norc", "-i"], {
    name: "xterm-256color",
    cols: 160,
    rows: 32,
    cwd: folder,
    env: {
      ...process.env,
      PS1: "TANDEM_READY> ",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
      HISTFILE: "/dev/null",
      HISTSIZE: "0",
      HISTFILESIZE: "0",
      PROMPT_COMMAND: "",
    },
  });
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let startup = "";
  let trace = "";
  const data = terminal.onData((text) => {
    if (process.env.TANDEM_PTY_TRACE === "1")
      trace = (trace + text).slice(-128000);
    startup = (startup + text).slice(-4096);
    if (startup.includes("TANDEM_READY>")) readyResolve();
    output.emit("data", Buffer.from(text));
  });
  let exitResolve!: () => void;
  const exit = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  const exited = terminal.onExit(() => {
    closed = true;
    output.emit("close");
    exitResolve();
  });
  const control = new SessionControl(
    sessionId,
    {
      isReady: () => !closed,
      write: (bytes) => terminal.write(Buffer.from(bytes).toString("utf8")),
    },
    () => {},
  );
  const failures: unknown[] = [];
  try {
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Bash did not become ready")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
    await test({
      control,
      executor: new PtyCommandExecutor(() => (closed ? null : output), 10000),
      root: windowsToPosix(folder),
      child: windowsToPosix(childFolder),
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    control.close();
    if (!closed) terminal.write("exit\r");
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("PTY did not exit")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
      data.dispose();
      exited.dispose();
    }
    // This is the test-created directory only; never remove an unchecked path.
    const resolved = fs.realpathSync(folder),
      allowed = fs.realpathSync(base);
    if (
      !allowed.startsWith(workspace + path.sep) ||
      !resolved.startsWith(workspace + path.sep) ||
      !resolved.startsWith(allowed + path.sep)
    )
      throw new Error("Test cleanup path escaped its workspace");
    if (process.env.TANDEM_PTY_TRACE === "1")
      fs.writeFileSync(
        path.join(base, path.basename(folder) + ".trace.json"),
        JSON.stringify(trace),
      );
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "PTY test and cleanup failed");
}

describe.runIf(!!shell && fs.existsSync(shell))("actual shared PTY", () => {
  it("automatically executes ordered commands in the same shell with preserved environment and cwd", async () => {
    await withTerminal(async ({ control, executor, root, child }) => {
      const lease = control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: "task" },
        control.snapshot(),
      );
      const policy = { revision: 1, sets: [] };
      const gateway = new OperationGateway(
        control,
        { hostId: "fixture", groupIds: [] },
        () => policy,
        executor,
        { append: async () => {} },
      );
      gateway.authorizeTask("task", lease, {
        matches: ["export", "printenv", "cd", "pwd", "printf"].map(
          (program) => ({ kind: "program" as const, program }),
        ),
        cwdScopes: [root],
        maxOperations: 8,
        expiresAt: Date.now() + 60000,
        expectedPolicyRevision: 1,
      });
      let request = 0;
      const run = async (program: string, args: string[], cwd = root) => {
        const action: CommandAction = {
          type: "terminal.command",
          program,
          args,
          cwd,
        };
        const op = await gateway.propose(
          {
            taskId: "task",
            requestId: String(++request),
            mode: "automatic",
            origin: "agent",
            lease,
          },
          action,
        );
        return gateway.dispatch(op.id);
      };
      expect((await run("export", ["TANDEM_SHARED_VALUE=来自AI"])).status).toBe(
        "succeeded",
      );
      expect(
        (await run("printenv", ["TANDEM_SHARED_VALUE"])).output?.trim(),
      ).toBe("来自AI");
      const moved = await run("cd", [child]);
      expect(moved.resultingCwd).toBe(child);
      expect((await run("pwd", [], moved.resultingCwd!)).output?.trim()).toBe(
        child,
      );
      const literal = "$(touch SHOULD_NOT_EXIST);带引号'和空格";
      const printed = (await run("printf", ["%s", literal], child)).output;
      // Observed Windows ConPTY output inserts a line boundary after OSC.
      // Preserve raw terminal output in production; only this platform-specific
      // test permits that exact prefix, never arbitrary trimming.
      expect(
        printed === literal ||
          (process.platform === "win32" && printed === "\r\n" + literal),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(child.replace(/^\/([a-z])\//, "$1:/"), "SHOULD_NOT_EXIST"),
        ),
      ).toBe(false);
    });
  }, 30000);

  it("observes manual changes when control returns, without opening another shell", async () => {
    await withTerminal(async ({ control, executor, root, child }) => {
      const oldLease = control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: "task" },
        control.snapshot(),
      );
      control.takeover();
      control.humanInput(
        Buffer.from(
          `cd ${quoteShellWord(child)}; export TANDEM_SHARED_VALUE=manual\r`,
        ),
      );
      expect(() => control.commitWrite(oldLease, Buffer.from("stale"))).toThrow(
        "STALE_CONTROL",
      );
      const lease = control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: "task" },
        control.snapshot(),
      );
      const context = executor.prepareContext();
      context.beforeSend?.();
      control.commitWrite(lease, context.bytes);
      const observed = await context.completion;
      context.dispose();
      expect(observed.cwd).toBe(child);
      const command = await executor.prepare(
        {
          type: "terminal.command",
          program: "printenv",
          args: ["TANDEM_SHARED_VALUE"],
          cwd: observed.cwd!,
        },
        "after-hand-back",
      );
      command.beforeSend?.();
      control.commitWrite(lease, command.bytes);
      expect((await command.completion).output.trim()).toBe("manual");
      command.dispose();
      expect(root).not.toBe(child);
    });
  }, 30000);
});

describe.runIf(!!shell && fs.existsSync(shell))(
  "task workbench with a real shared shell",
  () => {
    it.each(["automatic", "collaborative"] as const)(
      "executes %s mode through TaskRuntime with real exit codes and shared state",
      async (mode) => {
        await withTerminal(async ({ control, executor, root, child }) => {
          const actor = { kind: "human" as const, userId: "fixture-user" };
          const runtime = new TaskRuntime({
            getSession: () => ({
              id: "real-pty",
              userId: actor.userId,
              hostId: 1,
              hostName: "fixture",
              groups: () => [],
              control,
              executor,
            }),
            policy: async () => ({ revision: 1, sets: [] }),
            audit: () => ({ append: async () => {}, record: async () => {} }),
          });
          const task = await runtime.create(actor, {
            sessionId: "real-pty",
            requestId: "real-" + mode,
            title: "真实终端验收",
            mode,
            commands: [
              { program: "export", args: ["TANDEM_TASK_VALUE=同舟"] },
              { program: "cd", args: [child] },
              { program: "printenv", args: ["TANDEM_TASK_VALUE"] },
              { program: "pwd", args: [] },
            ],
          });
          await runtime.authorize(actor, task.id, {
            ...control.snapshot(),
            policyRevision: 1,
            shellReady: true,
            directory: root,
            maxOperations: 4,
            durationMinutes: 1,
            allowReviewedPlan: false,
          });
          if (mode === "collaborative") {
            for (let index = 0; index < 4; index++) {
              await vi.waitFor(
                () =>
                  expect(runtime.get(actor, task.id).state).toBe(
                    "awaiting-approval",
                  ),
                { timeout: 10000 },
              );
              const view = runtime.get(actor, task.id),
                op = view.operations[index];
              expect(
                view.operations.filter((item) => item.status === "succeeded"),
              ).toHaveLength(index);
              await runtime.approve(
                actor,
                task.id,
                op.id,
                op.digest,
                view.policyRevision,
              );
            }
          }
          await vi.waitFor(
            () => expect(runtime.get(actor, task.id).state).toBe("completed"),
            { timeout: 10000 },
          );
          const view = runtime.get(actor, task.id);
          expect(view.operations.map((op) => op.exitCode)).toEqual([
            0, 0, 0, 0,
          ]);
          expect(view.operations[2].output?.trim()).toBe("同舟");
          expect(view.operations[3].output?.trim()).toBe(child);
          expect(control.snapshot().controller.kind).toBe("human");
        });
      },
      30000,
    );
  },
);

describe.runIf(!!shell && fs.existsSync(shell))(
  "workflow multiline arguments on actual PTY",
  () => {
    it("preserves exact multiline and trailing whitespace through a real shell", async () => {
      await withTerminal(async ({ control, executor, root }) => {
        const lease = control.grant(
          {
            kind: "automation",
            ownerType: "workflow-run",
            ownerId: "multiline",
          },
          control.snapshot(),
        );
        const payload = "首行\n$(printf unexpected); 'quoted'\tending\n\n";
        const action: CommandAction = {
          type: "terminal.command",
          program: "bash",
          args: [
            "-c",
            'printf "%s" "$1" | base64 | tr -d "\\r\\n"',
            "tandem-test",
            payload,
          ],
          cwd: root,
        };
        const prepared = await executor.prepare(action, "multiline");
        prepared.beforeSend?.();
        control.commitWrite(lease, prepared.bytes);
        const result = await prepared.completion;
        prepared.dispose();
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain(
          Buffer.from(payload).toString("base64"),
        );
        expect(result.output).not.toContain("unexpected");
      });
    }, 20000);
  },
);

describe.runIf(!!shell && fs.existsSync(shell))(
  "MCP saved workflows on a real shared PTY",
  () => {
    it.each(["automatic", "collaborative"] as const)(
      "uses the parent's lease and shell in %s mode",
      async (mode) => {
        const sessionId = randomUUID();
        await withTerminal(async ({ control, executor, root }) => {
          const principal = {
            clientId: randomUUID(),
            connectionId: randomUUID(),
            userId: "owner",
            allowedHostIds: [7],
            readTerminal: false,
          };
          const human = { kind: "human" as const, userId: "owner" };
          const runtime = new TaskRuntime({
            getSession: (id) =>
              id === sessionId
                ? {
                    id: sessionId,
                    userId: "owner",
                    hostId: 7,
                    hostName: "fixture",
                    groups: () => [],
                    control,
                    executor,
                  }
                : null,
            policy: async () => ({ revision: 1, sets: [] }),
            audit: () => ({ append: async () => {}, record: async () => {} }),
          });
          runtime.connectClient(principal.connectionId);
          let stored: string | undefined;
          const workflows = new WorkflowLibrary({
            read: () => stored,
            write: async (_, value) => {
              stored = value;
            },
            ownsHost: async (_, host) => host === 7,
            target: () => ({
              hostId: 7,
              groups: [],
              control: control.snapshot(),
            }),
            policy: () => ({ revision: 1, sets: [] }),
            tasks: runtime,
            audit: async () => {},
          });
          const saved = await workflows.save("owner", {
            allowedHostIds: [7],
            definition: {
              schemaVersion: 1,
              id: "shared-shell",
              name: "MCP 共享会话流程",
              version: "1.0.0",
              parameters: {},
              defaults: { cwd: root },
              steps: [
                {
                  id: "set",
                  name: "设置共享变量",
                  action: {
                    type: "command",
                    program: "export",
                    args: ["TANDEM_MCP_FLOW=MCP 流程共用会话"],
                  },
                },
                {
                  id: "read",
                  name: "读取共享变量",
                  action: {
                    type: "command",
                    program: "printenv",
                    args: ["TANDEM_MCP_FLOW"],
                  },
                },
              ],
            },
          });
          const core = new McpCore({
            tasks: runtime,
            workflows,
            hosts: async () => [
              { id: 7, name: "fixture", address: "127.0.0.1", port: 22 },
            ],
            sessions: () => [
              {
                id: sessionId,
                hostId: 7,
                hostName: "fixture",
                connected: true,
                control: control.snapshot(),
              },
            ],
            output: () => ({
              text: "manual private output",
              cursor: 1,
              firstCursor: 0,
              generation: 1,
            }),
            open: async () => {
              throw Error("UNEXPECTED_CONNECTION");
            },
          });
          const server = createTandemMcpServer({
              invoke: (method, parameters, signal) =>
                core.invoke(
                  principal,
                  method,
                  parameters,
                  signal ?? new AbortController().signal,
                ),
            }),
            client = new Client({
              name: "codex-workflow-test",
              version: "1.0",
            });
          const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          async function invoke(name: string, args: Record<string, unknown>) {
            const response = await client.callTool({ name, arguments: args });
            expect(response.isError).not.toBe(true);
            return (
              response.structuredContent as { result: Record<string, unknown> }
            ).result;
          }
          try {
            const toolNames = (await client.listTools()).tools.map(
              (tool) => tool.name,
            );
            expect(toolNames).toHaveLength(24);
            expect(toolNames).toEqual(
              expect.arrayContaining([
                "list_directory",
                "stat_file",
                "read_file",
                "get_file_content",
                "propose_file_edit",
                "propose_file_write",
              ]),
            );
            expect(toolNames).not.toContain("approve_operation");
            const catalog = await invoke("list_workflows", { hostId: 7 });
            expect(catalog.workflows).toMatchObject([
              { id: saved.id, name: "MCP 共享会话流程" },
            ]);
            const detail = await invoke("get_workflow", {
              hostId: 7,
              workflowId: saved.id,
            });
            expect(detail.requiresPreview).toBe(true);
            const parent = await invoke("start_task", {
              sessionId,
              requestId: "parent",
              goal: "检查共享流程",
              mode,
            });
            const taskId = parent.id as string;
            await runtime.authorize(human, taskId, {
              ...control.snapshot(),
              policyRevision: 1,
              shellReady: true,
              directory: root,
              maxOperations: 5,
              durationMinutes: 1,
              matches: ["export", "printenv", "pwd"].map((program) => ({
                kind: "program" as const,
                program,
              })),
              allowReviewedPlan: false,
            });
            const lease = control.snapshot();
            const preview = await invoke("preview_workflow", {
              workflowId: saved.id,
              sessionId,
              parentTaskId: taskId,
              parameters: {},
            });
            const run = await invoke("run_workflow", {
              taskId,
              previewId: preview.id,
              requestId: "flow",
            });
            if (mode === "collaborative")
              for (let step = 0; step < 2; step++) {
                await vi.waitFor(
                  () =>
                    expect(runtime.get(human, taskId).state).toBe(
                      "awaiting-approval",
                    ),
                  { timeout: 5000 },
                );
                const op = runtime.get(human, taskId).operations.at(-1)!;
                await runtime.approve(human, taskId, op.id, op.digest, 1);
                await vi.waitFor(
                  () =>
                    expect(runtime.operation(human, taskId, op.id).status).toBe(
                      "succeeded",
                    ),
                  { timeout: 5000 },
                );
              }
            await vi.waitFor(
              () =>
                expect(
                  runtime.workflowRun(human, taskId, run.id as string).state,
                ).toBe("completed"),
              { timeout: 5000 },
            );
            expect(control.snapshot()).toEqual(lease);
            const result = await invoke("get_workflow_run", {
              taskId,
              workflowRunId: run.id,
            });
            expect(result.operations).toMatchObject([
              { exitCode: 0 },
              {
                exitCode: 0,
                output: expect.stringContaining("MCP 流程共用会话"),
              },
            ]);
            const free = await invoke("run_command", {
              taskId,
              requestId: "after-flow",
              program: "printenv",
              args: ["TANDEM_MCP_FLOW"],
            });
            const op = (free.operation as { id: string }).id;
            if (mode === "collaborative") {
              await vi.waitFor(() =>
                expect(runtime.get(human, taskId).state).toBe(
                  "awaiting-approval",
                ),
              );
              const view = runtime.get(human, taskId).operations.at(-1)!;
              await runtime.approve(human, taskId, view.id, view.digest, 1);
            }
            await vi.waitFor(
              () =>
                expect(runtime.operation(human, taskId, op).status).toBe(
                  "succeeded",
                ),
              { timeout: 5000 },
            );
            expect(runtime.operation(human, taskId, op).output).toContain(
              "MCP 流程共用会话",
            );
            expect(
              (
                await client.callTool({
                  name: "read_terminal",
                  arguments: { sessionId },
                })
              ).isError,
            ).toBe(true);
            expect((await invoke("finish_task", { taskId })).state).toBe(
              "completed",
            );
            expect(control.snapshot().controller.kind).toBe("human");
            const standalonePreview = await invoke("preview_workflow", {
              workflowId: saved.id,
              sessionId,
              parameters: {},
            });
            const standalone = await invoke("start_workflow", {
              previewId: standalonePreview.id,
              requestId: "standalone",
              mode,
            });
            expect(standalone.state).toBe("awaiting-authorization");
            const standaloneId = standalone.id as string;
            await runtime.authorize(human, standaloneId, {
              ...control.snapshot(),
              policyRevision: 1,
              shellReady: true,
              directory: root,
              maxOperations: 2,
              durationMinutes: 1,
              allowReviewedPlan: false,
            });
            if (mode === "collaborative")
              for (let i = 0; i < 2; i++) {
                await vi.waitFor(
                  () =>
                    expect(runtime.get(human, standaloneId).state).toBe(
                      "awaiting-approval",
                    ),
                  { timeout: 5000 },
                );
                const op = runtime.get(human, standaloneId).operations.at(-1)!;
                await runtime.approve(human, standaloneId, op.id, op.digest, 1);
                await vi.waitFor(
                  () =>
                    expect(
                      runtime.operation(human, standaloneId, op.id).status,
                    ).toBe("succeeded"),
                  { timeout: 5000 },
                );
              }
            await vi.waitFor(
              () =>
                expect(runtime.get(human, standaloneId).state).toBe(
                  "completed",
                ),
              { timeout: 5000 },
            );
            expect(
              runtime
                .get(human, standaloneId)
                .operations.map((op) => op.exitCode),
            ).toEqual([0, 0]);
            expect(control.snapshot().controller.kind).toBe("human");
          } finally {
            runtime.disconnectClient(principal.connectionId);
            await client.close();
            await server.close();
          }
        }, sessionId);
      },
      30000,
    );
  },
);

describe.runIf(!!shell)("legacy command tasks on a real PTY", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode keeps parameters literal and cwd shared",
    async (mode) => {
      await withTerminal(async ({ control, executor, root, child }) => {
        const sessionId = control.snapshot().sessionId,
          human = { kind: "human" as const, userId: "owner" };
        const tasks = new TaskRuntime({
          getSession: (id) =>
            id === sessionId
              ? {
                  id: sessionId,
                  userId: "owner",
                  hostId: 1,
                  hostName: "fixture",
                  groups: () => [],
                  control,
                  executor,
                }
              : null,
          policy: async () => ({ revision: 1, sets: [] }),
          audit: () => ({ record: async () => {}, append: async () => {} }),
        });
        const service = new LegacyCommandService({
          tasks,
          notify: () => {},
          target: async () => ({
            hostId: 1,
            hostName: "fixture",
            host: {
              ip: "127.0.0.1",
              username: "fixture",
              port: 22,
              name: "测试",
            },
            control: control.snapshot(),
          }),
        });
        const marker = root + "/must-not-execute",
          value = "literal; touch " + quoteShellWord(marker) + "\n$&$$";
        const { task } = await service.create("owner", {
          sessionId,
          requestId: "legacy-real",
          mode,
          source: {
            kind: "snippet",
            title: "参数与目录",
            content: 'cd "$INPUT_1"\nprintf "%s" "$INPUT_2"\npwd',
            inputs: { INPUT_1: child, INPUT_2: value },
          },
        });
        expect(task.operations).toHaveLength(0);
        await tasks.authorize(human, task.id, {
          ...control.snapshot(),
          policyRevision: 1,
          shellReady: true,
          directory: root,
          maxOperations: 5,
          durationMinutes: 5,
          allowReviewedPlan: false,
        });
        if (mode === "collaborative")
          for (let i = 0; i < 3; i++) {
            await vi.waitFor(
              () =>
                expect(tasks.get(human, task.id).state).toBe(
                  "awaiting-approval",
                ),
              { timeout: 5000 },
            );
            const op = tasks.get(human, task.id).operations.at(-1)!;
            await tasks.approve(human, task.id, op.id, op.digest, 1);
          }
        await vi.waitFor(
          () => expect(tasks.get(human, task.id).state).toBe("completed"),
          { timeout: 5000 },
        );
        const result = tasks.get(human, task.id);
        expect(result.cwd).toBe(child);
        expect(result.operations[1].output?.replace(/\r/g, "")).toBe(value);
        const native =
          process.platform === "win32"
            ? marker.replace(
                /^\/([a-z])\//i,
                (_, drive) => drive.toUpperCase() + ":/",
              )
            : marker;
        expect(fs.existsSync(native)).toBe(false);
      });
    },
    15000,
  );
  it("human takeover prevents the rest of a converted macro from being sent", async () => {
    await withTerminal(async ({ control, executor, root }) => {
      const sessionId = control.snapshot().sessionId,
        human = { kind: "human" as const, userId: "owner" };
      const tasks = new TaskRuntime({
        getSession: (id) =>
          id === sessionId
            ? {
                id: sessionId,
                userId: "owner",
                hostId: 1,
                hostName: "fixture",
                groups: () => [],
                control,
                executor,
              }
            : null,
        policy: async () => ({ revision: 1, sets: [] }),
        audit: () => ({ record: async () => {}, append: async () => {} }),
      });
      const service = new LegacyCommandService({
        tasks,
        notify: () => {},
        target: async () => ({
          hostId: 1,
          hostName: "fixture",
          host: { ip: "127.0.0.1", username: "u", port: 22, name: "测试" },
          control: control.snapshot(),
        }),
      });
      const marker = root + "/old-macro-marker",
        { task } = await service.create("owner", {
          sessionId,
          requestId: "takeover",
          mode: "automatic",
          source: {
            kind: "macro",
            title: "接管",
            steps: [
              { id: "delay", type: "delay", milliseconds: 600 },
              {
                id: "send",
                type: "send",
                text: "touch " + quoteShellWord(marker),
                pressEnter: true,
              },
            ],
          },
        });
      await tasks.authorize(human, task.id, {
        ...control.snapshot(),
        policyRevision: 1,
        shellReady: true,
        directory: root,
        maxOperations: 5,
        durationMinutes: 5,
        allowReviewedPlan: false,
      });
      await vi.waitFor(() =>
        expect(tasks.get(human, task.id).operations[0]?.status).toBe("running"),
      );
      control.takeover();
      await new Promise((r) => setTimeout(r, 850));
      expect(tasks.get(human, task.id).operations).toHaveLength(1);
      const native =
        process.platform === "win32"
          ? marker.replace(
              /^\/([a-z])\//i,
              (_, drive) => drive.toUpperCase() + ":/",
            )
          : marker;
      expect(fs.existsSync(native)).toBe(false);
    });
  }, 15000);
});
