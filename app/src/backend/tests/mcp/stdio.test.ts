import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LocalBridgeServer } from "../../mcp/bridge/server.js";
import { localBridgeEndpoint } from "../../mcp/bridge/endpoint.js";
import { SystemPairingSecretStore } from "../../mcp/credential-store.js";
import { McpCore } from "../../mcp/core.js";
import { WorkflowLibrary } from "../../collaboration/workflows/library.js";
import {
  TaskRuntime,
  type TaskActor,
} from "../../collaboration/tasks/runtime.js";
import { SessionControl } from "../../collaboration/sessions/control.js";
const appRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const entry =
  process.env.TANDEM_TEST_MCP_ENTRY ??
  path.resolve(appRoot, "dist/backend/backend/mcp/stdio.js");
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
describe.runIf(process.platform === "win32" && fs.existsSync(entry))(
  "actual MCP stdio process with OS credentials and shared task core",
  () => {
    it("waits for desktop authorization, runs a scoped command and loses authority on disconnect", async () => {
      const profileId = randomUUID(),
        clientId = randomUUID(),
        reference = { profileId, clientId },
        secret = randomBytes(32),
        store = new SystemPairingSecretStore();
      await store.write(reference, secret);
      closers.push(async () => {
        await store.remove(reference);
      });
      const writes: string[] = [];
      const sessionId = randomUUID();
      const control = new SessionControl(
        sessionId,
        {
          isReady: () => true,
          write: (bytes) => {
            writes.push(Buffer.from(bytes).toString());
          },
        },
        () => {},
      );
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
                executor: {
                  prepareContext: () => ({
                    bytes: Buffer.from("context"),
                    completion: Promise.resolve({
                      exitCode: 0,
                      output: "",
                      cwd: "/srv",
                    }),
                    dispose: () => {},
                  }),
                  prepare: async (command) => ({
                    bytes: Buffer.from(command.program),
                    completion: Promise.resolve({
                      exitCode: 0,
                      output: "同舟 MCP 已执行\nAPI_KEY=do-not-export",
                      cwd: command.cwd,
                    }),
                    dispose: () => {},
                  }),
                },
              }
            : null,
        policy: async () => ({ revision: 1, sets: [] }),
        audit: () => ({ record: async () => {}, append: async () => {} }),
      });
      let workflowStore: string | undefined;
      const workflows = new WorkflowLibrary({
        read: () => workflowStore,
        write: async (_, value) => {
          workflowStore = value;
        },
        ownsHost: async (user, host) => user === "owner" && host === 7,
        target: (_actor, id) => {
          if (id !== sessionId) throw Error("SESSION_NOT_FOUND");
          return { hostId: 7, groups: [], control: control.snapshot() };
        },
        policy: () => ({ revision: 1, sets: [] }),
        tasks: runtime,
        audit: async () => {},
      });
      const savedWorkflow = await workflows.save("owner", {
        allowedHostIds: [7],
        definition: {
          schemaVersion: 1,
          id: "stdio-flow",
          name: "独立进程流程",
          version: "1.0.0",
          parameters: {},
          defaults: { cwd: "/srv" },
          steps: [
            {
              id: "one",
              name: "输出",
              action: {
                type: "command",
                program: "printf",
                args: ["from-saved-template"],
              },
            },
          ],
        },
      });
      const core = new McpCore({
        workflows,
        tasks: runtime,
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
          text: "manual",
          cursor: 1,
          generation: 1,
          firstCursor: 0,
        }),
        open: async () => ({ state: "connected", sessionId }),
      });
      const server = new LocalBridgeServer({
        profileId,
        authenticate: async (id) =>
          id === clientId
            ? {
                secret,
                identity: {
                  clientId,
                  userId: "owner",
                  allowedHostIds: [7],
                  readTerminal: false,
                },
              }
            : null,
        isAllowed: () => true,
        connected: (p) => runtime.connectClient(p.connectionId),
        disconnected: (p) => runtime.disconnectClient(p.connectionId),
        invoke: (...args) => core.invoke(...args),
      });
      await server.listen(localBridgeEndpoint(profileId));
      closers.push(() => server.close());
      const transport = new StdioClientTransport({
        command: process.env.TANDEM_TEST_MCP_EXECUTABLE ?? process.execPath,
        env: process.env.TANDEM_TEST_MCP_EXECUTABLE
          ? { ELECTRON_RUN_AS_NODE: "1" }
          : undefined,
        args: [entry, "--profile", profileId, "--client", clientId],
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      const client = new Client({
        name: "codex-stdio-acceptance",
        version: "1.0.0",
      });
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe(
        JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"))
          .version,
      );
      closers.push(() => client.close());
      const tools = await client.listTools();
      if (process.env.TANDEM_TEST_CODEX) {
        const configPath = path.resolve(
          appRoot,
          "../.cache/codex-workflow-probe-" + profileId + ".json",
        );
        fs.writeFileSync(
          configPath,
          JSON.stringify({
            command: process.env.TANDEM_TEST_MCP_EXECUTABLE ?? process.execPath,
            args: [entry, "--profile", profileId, "--client", clientId],
          }),
        );
        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                path.resolve(appRoot, "../scripts/verify-codex-mcp.cjs"),
                configPath,
              ],
              {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                  ...process.env,
                  TANDEM_TEST_CODEX: process.env.TANDEM_TEST_CODEX,
                },
              },
            );
            let error = "";
            child.stderr.on("data", (data) => {
              error = (error + String(data)).slice(-2000);
            });
            const timer = setTimeout(() => {
              child.kill();
              reject(Error("Codex discovery timed out"));
            }, 45000);
            child.once("error", (reason) => {
              clearTimeout(timer);
              reject(reason);
            });
            child.once("exit", (code) => {
              clearTimeout(timer);
              if (code === 0) resolve();
              else reject(Error(error || "Codex discovery failed"));
            });
          });
        } finally {
          fs.unlinkSync(configPath);
        }
      }

      expect(tools.tools.map((tool) => tool.name)).toContain("finish_task");
      const created = await client.callTool({
        name: "start_task",
        arguments: {
          sessionId,
          requestId: "task-1",
          goal: "检查服务器",
          mode: "automatic",
        },
      });
      expect(created.isError).not.toBe(true);
      const task = (
        created.structuredContent as { result: { id: string; state: string } }
      ).result;
      expect(task.state).toBe("awaiting-authorization");
      expect(writes).toEqual([]);
      const human: TaskActor = { kind: "human", userId: "owner" };
      await runtime.authorize(human, task.id, {
        ...control.snapshot(),
        policyRevision: 1,
        shellReady: true,
        maxOperations: 2,
        durationMinutes: 1,
        allowReviewedPlan: false,
        matches: [{ kind: "program", program: "printf" }],
      });
      const result = await client.callTool({
        name: "run_command",
        arguments: {
          taskId: task.id,
          requestId: "cmd-1",
          program: "printf",
          args: ["ok"],
        },
      });
      expect(result.isError).not.toBe(true);
      await vi.waitFor(() =>
        expect(runtime.get(human, task.id).operations[0].status).toBe(
          "succeeded",
        ),
      );
      const operationId = runtime.get(human, task.id).operations[0].id;
      const output = await client.callTool({
        name: "get_operation",
        arguments: { taskId: task.id, operationId },
      });
      expect(JSON.stringify(output)).toContain("同舟 MCP 已执行");
      expect(JSON.stringify(output)).not.toContain("do-not-export");
      expect(writes).toEqual(["context", "printf"]);
      expect(tools.tools).toHaveLength(38);
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "preview_directory_transfer",
          "get_directory_transfer",
          "run_directory_transfer",
          "get_directory_run",
          "release_directory_transfer",
          "list_directory",
          "stat_file",
          "read_file",
          "get_file_content",
          "propose_file_edit",
          "propose_file_write",
        ]),
      );
      const previewResponse = await client.callTool({
        name: "preview_workflow",
        arguments: {
          workflowId: savedWorkflow.id,
          sessionId,
          parentTaskId: task.id,
          parameters: {},
        },
      });
      expect(previewResponse.isError).not.toBe(true);
      const preview = (
        previewResponse.structuredContent as { result: { id: string } }
      ).result;
      const flowResponse = await client.callTool({
        name: "run_workflow",
        arguments: {
          taskId: task.id,
          previewId: preview.id,
          requestId: "stdio-workflow",
        },
      });
      expect(flowResponse.isError).not.toBe(true);
      const flow = (
        flowResponse.structuredContent as { result: { id: string } }
      ).result;
      await vi.waitFor(() =>
        expect(runtime.workflowRun(human, task.id, flow.id).state).toBe(
          "completed",
        ),
      );
      const flowResult = await client.callTool({
        name: "get_workflow_run",
        arguments: { taskId: task.id, workflowRunId: flow.id },
      });
      expect(flowResult.isError).not.toBe(true);
      expect(JSON.stringify(flowResult)).toContain("同舟 MCP 已执行");
      expect(JSON.stringify(flowResult)).not.toContain("do-not-export");
      expect(writes).toEqual(["context", "printf", "printf"]);

      const terminal = await client.callTool({
        name: "read_terminal",
        arguments: { sessionId },
      });
      expect(terminal.isError).toBe(true);
      expect(JSON.stringify(terminal)).toContain("MCP_TERMINAL_READ_DENIED");
      server.disconnect(clientId);
      expect(control.snapshot().controller.kind).toBe("human");
      expect(runtime.get(human, task.id).state).toBe("cancelled");
      expect(stderr).not.toContain(secret.toString("hex"));
    }, 65000);
  },
);
