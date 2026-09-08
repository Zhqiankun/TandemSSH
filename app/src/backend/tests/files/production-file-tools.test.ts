import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SystemPairingSecretStore } from "../../mcp/credential-store";
import { LocalBridgeServer } from "../../mcp/bridge/server";
import { localBridgeEndpoint } from "../../mcp/bridge/endpoint";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { SessionControl } from "../../collaboration/sessions/control";
import { TaskRuntime, type TaskActor } from "../../collaboration/tasks/runtime";
import { AutomatedDocuments } from "../../files/automated-documents";
import { FileAutomation } from "../../collaboration/files/automation";
import { McpCore } from "../../mcp/core";
import { createTandemMcpServer } from "../../mcp/server";
import type { FileBodyView } from "../../../types/file-automation";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  journal: vi.fn(async () => {}),
}));
vi.mock("../../hosts/terminal/session-manager.js", () => ({
  sessionManager: { getSession: mocks.lookup, getUserSessions: () => [] },
}));
vi.mock("../../collaboration/audit/production.js", () => ({
  journalFor: () => ({ record: mocks.journal }),
}));
import { documents, openAutomatedFileTarget } from "../../files/production";
afterEach(() => {
  documents.dispose();
  mocks.lookup.mockReset();
  mocks.journal.mockClear();
});
describe("production file tools over a reused SSH connection", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s MCP file editing uses one authenticated SSH connection",
    async (mode) => {
      const remote = await fileSftpFixture(),
        sessionId = randomUUID(),
        principal = {
          userId: "owner",
          clientId: randomUUID(),
          connectionId: randomUUID(),
          allowedHostIds: [7],
          readTerminal: true,
        };
      const actor: TaskActor = { kind: "mcp", ...principal },
        human: TaskActor = { kind: "human", userId: "owner" },
        writes: string[] = [];
      const control = new SessionControl(
        sessionId,
        {
          isReady: () => true,
          write: (bytes) => writes.push(Buffer.from(bytes).toString()),
        },
        () => {},
      );
      const terminal = {
        id: sessionId,
        userId: "owner",
        hostId: 7,
        hostName: "fixture@127.0.0.1:" + remote.port,
        sshConn: remote.client,
        isConnected: true,
        control,
      };
      mocks.lookup.mockImplementation((id) =>
        id === sessionId ? terminal : null,
      );
      const store = new AutomatedDocuments(documents, {
        open: openAutomatedFileTarget,
      });
      const tasks = new TaskRuntime({
        fileReviewValid: (...args) => store.validReview(...args),
        getSession: (id) =>
          id === sessionId
            ? {
                ...terminal,
                groups: () => [],
                files: store.executor("owner", sessionId),
                executor: {
                  prepareContext: () => ({
                    bytes: Buffer.from("context-probe"),
                    completion: Promise.resolve({
                      exitCode: 0,
                      output: "",
                      cwd: "/",
                    }),
                    dispose: () => {},
                  }),
                  prepare: async () => {
                    throw Error("UNEXPECTED_TERMINAL_COMMAND");
                  },
                },
              }
            : null,
        policy: async () => ({ revision: 1, sets: [] }),
        audit: () => ({ record: async () => {}, append: async () => {} }),
      });
      tasks.connectClient(principal.connectionId);
      const files = new FileAutomation(tasks, store);
      const core = new McpCore({
        files,
        tasks,
        hosts: async () => [
          { id: 7, name: "fixture", address: "127.0.0.1", port: remote.port },
        ],
        sessions: () => [],
        output: () => ({ text: "", cursor: 0, generation: 1, firstCursor: 0 }),
        open: async () => {
          throw Error("SECOND_SSH_CONNECTION_FORBIDDEN");
        },
      });
      const client = new McpClient({ name: "file-verification", version: "1" });
      const appRoot = fileURLToPath(new URL("../../../../", import.meta.url));
      const entry =
        process.env.TANDEM_TEST_MCP_ENTRY ??
        path.join(appRoot, "dist/backend/backend/mcp/stdio.js");
      const native = process.platform === "win32" && fs.existsSync(entry);
      const cleanupTransport: Array<() => Promise<void>> = [];
      let liveActor: TaskActor = actor;
      const setup = async () => {
        if (process.env.TANDEM_TEST_REQUIRE_STDIO === "1" && !native)
          throw Error("COMPILED_STDIO_REQUIRED");
        if (native) {
          const reference = {
              profileId: randomUUID(),
              clientId: principal.clientId,
            },
            secret = randomBytes(32),
            secrets = new SystemPairingSecretStore();
          await secrets.write(reference, secret);
          cleanupTransport.push(() => secrets.remove(reference));
          const bridge = new LocalBridgeServer({
            profileId: reference.profileId,
            authenticate: async (id) =>
              id === principal.clientId
                ? {
                    secret,
                    identity: {
                      clientId: principal.clientId,
                      userId: "owner",
                      allowedHostIds: [7],
                      readTerminal: true,
                    },
                  }
                : null,
            isAllowed: () => true,
            connected: (p) => {
              liveActor = { kind: "mcp", ...p };
              tasks.connectClient(p.connectionId);
            },
            disconnected: (p) => tasks.disconnectClient(p.connectionId),
            invoke: (...args) => core.invoke(...args),
          });
          await bridge.listen(localBridgeEndpoint(reference.profileId));
          cleanupTransport.push(() => bridge.close());
          const transport = new StdioClientTransport({
            command: process.env.TANDEM_TEST_MCP_EXECUTABLE ?? process.execPath,
            args: [
              entry,
              "--profile",
              reference.profileId,
              "--client",
              reference.clientId,
            ],
            env: process.env.TANDEM_TEST_MCP_EXECUTABLE
              ? { ELECTRON_RUN_AS_NODE: "1" }
              : undefined,
            stderr: "pipe",
          });
          await client.connect(transport);
        } else {
          const server = createTandemMcpServer({
            invoke: (method, args, signal) =>
              core.invoke(
                principal,
                method,
                args,
                signal ?? new AbortController().signal,
              ),
          });
          const [left, right] = InMemoryTransport.createLinkedPair();
          await server.connect(right);
          cleanupTransport.push(() => server.close());
          await client.connect(left);
        }
      };
      async function call<T>(
        name: string,
        args: Record<string, unknown>,
      ): Promise<T> {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        return (response.structuredContent as { result: T }).result;
      }
      let testFailed = false,
        testError: unknown,
        cleanupFailed = false;
      try {
        await setup();
        const catalog = await client.listTools();
        expect(catalog.tools.map((t) => t.name)).toEqual(
          expect.arrayContaining([
            "list_directory",
            "stat_file",
            "read_file",
            "get_file_content",
            "propose_file_edit",
            "propose_file_write",
          ]),
        );
        expect(catalog.tools).toHaveLength(34);
        expect(catalog.tools.some((t) => /approve|grant/.test(t.name))).toBe(
          false,
        );
        const task = await call<{ id: string }>("start_task", {
          sessionId,
          requestId: randomUUID(),
          goal: "真实 SFTP 文件验证",
          mode,
        });
        await tasks.authorize(human, task.id, {
          ...control.snapshot(),
          policyRevision: 1,
          shellReady: true,
          maxOperations: 5,
          durationMinutes: 5,
          allowReviewedPlan: false,
          matches: [],
          fileScopes: [
            { kind: "directory", path: "/目录", access: ["read", "write"] },
          ],
        });
        for (const [name, path] of [
          ["list_directory", "/目录"],
          ["stat_file", "/目录/配置%2F.txt"],
        ] as const) {
          const submitted = await call<{ operationId: string }>(name, {
            taskId: task.id,
            path,
            requestId: name,
          });
          if (mode === "collaborative") {
            await vi.waitFor(() =>
              expect(
                tasks.operation(human, task.id, submitted.operationId).status,
              ).toBe("awaiting-approval"),
            );
            const op = tasks.operation(human, task.id, submitted.operationId);
            await tasks.approve(human, task.id, op.id, op.digest, 1);
          }
          await vi.waitFor(() =>
            expect(
              tasks.operation(human, task.id, submitted.operationId).status,
            ).toBe("succeeded"),
          );
          const result = tasks.operation(
            human,
            task.id,
            submitted.operationId,
          ).fileResult!;
          if (name === "list_directory") {
            expect(result.directory!.entries.map((e) => e.name)).toEqual([
              "配置%2F.txt",
            ]);
            expect(result.directory!.contentTrust).toBe(
              "untrusted-directory-entries",
            );
          } else
            expect(result.metadata).toMatchObject({
              canonicalPath: "/目录/配置%2F.txt",
              metadata: { kind: "file", mode: 0o640 },
            });
        }
        expect(remote.directoryReads()).toBeGreaterThan(1);
        expect(remote.directoryHandles()).toBe(0);
        const read = await call<{ operationId: string }>("read_file", {
          taskId: task.id,
          path: "/目录/配置%2F.txt",
          requestId: "read",
        });
        if (mode === "collaborative") {
          await vi.waitFor(() =>
            expect(
              tasks.operation(human, task.id, read.operationId).status,
            ).toBe("awaiting-approval"),
          );
          const op = tasks.operation(human, task.id, read.operationId);
          await tasks.approve(human, task.id, op.id, op.digest, 1);
        }
        await vi.waitFor(() =>
          expect(tasks.operation(human, task.id, read.operationId).status).toBe(
            "succeeded",
          ),
        );
        const version = tasks.operation(human, task.id, read.operationId)
          .fileResult!.document!.version;
        const body = await call<FileBodyView>("get_file_content", {
          taskId: task.id,
          version,
        });
        expect(body.content).toBe("原始内容\n");
        expect(body.document.hostIdentity).toBe(terminal.hostName);
        const edit = await call<{ operationId: string }>("propose_file_edit", {
          taskId: task.id,
          version,
          edits: [{ before: "原始内容", after: "工具修改成功" }],
          saveAs: "/目录/工具结果.txt",
          requestId: "edit",
        });
        if (mode === "collaborative") {
          await vi.waitFor(() =>
            expect(
              tasks.operation(human, task.id, edit.operationId).status,
            ).toBe("awaiting-approval"),
          );
          const op = tasks.operation(human, task.id, edit.operationId);
          await expect(
            tasks.approve(human, task.id, op.id, op.digest, 1),
          ).rejects.toThrow("FILE_REVIEW_REQUIRED");
          const review = files.review(human, task.id, op.id);
          expect(review.after).toBe("工具修改成功\n");
          await tasks.approve(
            human,
            task.id,
            op.id,
            op.digest,
            1,
            review.reviewId,
          );
        }
        await vi.waitFor(() =>
          expect(tasks.operation(human, task.id, edit.operationId).status).toBe(
            "succeeded",
          ),
        );
        expect((await remote.read("/目录/工具结果.txt")).toString()).toBe(
          "工具修改成功\r\n",
        );
        expect(remote.connections()).toBe(1);
        expect(writes).toEqual(["context-probe"]);
        await client.close();
        if (!native) tasks.disconnectClient(principal.connectionId);
        await vi.waitFor(() =>
          expect(tasks.get(human, task.id).state).toBe("cancelled"),
        );
        expect(() => files.content(liveActor, task.id, { version })).toThrow(
          "CLIENT_CONNECTION_CHANGED",
        );
        expect(
          (
            await remote.io.snapshot("/目录/工具结果.txt", 1024)
          ).bytes.toString(),
        ).toBe("工具修改成功\r\n");
        fs.writeFileSync(
          path.resolve(appRoot, "../.cache/file-native-" + mode + ".json"),
          JSON.stringify(
            {
              mode,
              transport: native
                ? "stdio+signed-pipe+OS-credentials"
                : "sdk-memory",
              toolCount: catalog.tools.length,
              sshConnections: remote.connections(),
              bytes: Buffer.byteLength("工具修改成功\r\n"),
              cancelledOnDisconnect: true,
              command:
                process.env.TANDEM_TEST_MCP_EXECUTABLE ?? process.execPath,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        testFailed = true;
        testError = error;
      } finally {
        for (const close of [
          () => client.close(),
          ...cleanupTransport.reverse(),
          async () => {
            control.close();
            store.dispose();
          },
          () => remote.close(),
        ]) {
          try {
            await close();
          } catch {
            cleanupFailed = true;
          }
        }
      }
      if (testFailed) throw testError;
      if (cleanupFailed) throw Error("FILE_TEST_CLEANUP_FAILED");
    },
    20000,
  );
});
