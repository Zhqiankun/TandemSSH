import { WorkflowLibrary } from "../collaboration/workflows/library";
import type { CommandPolicySnapshot } from "../../types/collaboration-operations";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { TaskRuntime, type TaskActor } from "../collaboration/tasks/runtime";
import { SessionControl } from "../collaboration/sessions/control";
import { AutomatedTransfers } from "../files/automated-transfers";
import { TransferAutomation } from "../collaboration/files/transfers";
import {
  LocalFileGrants,
  type NativeTaskLocalFiles,
} from "../files/local-file-grants";
import { FilePathLocks } from "../files/path-locks";
import { McpCore } from "../mcp/core";
import { fileSftpFixture } from "./file-sftp-fixture";
const require = createRequire(import.meta.url),
  { TaskLocalFiles } = require("../../../electron/task-local-files.cjs");
export async function transferToolsFixture() {
  const remote = await fileSftpFixture();
  await remote.mkdir("/srv");
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "transfer-tools-"));
  const source = path.join(folder, "产物.bin"),
    destination = path.join(folder, "结果.bin"),
    bytes = Buffer.from([0, 255, 128, 10, 3]);
  await fs.writeFile(source, bytes);
  const userId = "owner",
    sessionId = randomUUID(),
    principal = {
      userId,
      clientId: randomUUID(),
      connectionId: randomUUID(),
      allowedHostIds: [7],
      readTerminal: true,
    };
  const human: TaskActor = { kind: "human", userId },
    actor: TaskActor = { kind: "mcp", ...principal },
    writes: string[] = [],
    events: unknown[] = [];
  const control = new SessionControl(
    sessionId,
    {
      isReady: () => true,
      write: (b) => writes.push(Buffer.from(b).toString()),
    },
    () => {},
  );
  const policy: CommandPolicySnapshot = { revision: 1, sets: [] };
  const runtime = new TaskRuntime({
    validateFileBinding: (userId, taskId, action) =>
      grants.assert(
        runtime.fileObservationContext({ kind: "human", userId }, taskId),
        action,
      ),
    releaseTransferProgress: (userId, taskId, operationId) =>
      transfers.forget(
        runtime.fileObservationContext({ kind: "human", userId }, taskId),
        operationId,
      ),
    getSession: (id) =>
      id === sessionId
        ? {
            id: sessionId,
            userId,
            hostId: 7,
            hostName: "fixture",
            groups: () => [],
            control,
            files: {
              prepare: (...args) =>
                transfers.executor(userId, sessionId).prepare(...args),
            },
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
                  output: "command result",
                  cwd: "/srv",
                }),
                dispose: () => {},
              }),
            },
          }
        : null,
    policy: async () => policy,
    audit: () => ({
      append: async (e) => {
        events.push(e);
      },
      record: async (type, data) => {
        events.push({ type, data });
      },
    }),
  });
  const native: NativeTaskLocalFiles = new TaskLocalFiles();
  const grants = new LocalFileGrants({
    available: () => true,
    native: () => native,
    context: (user, task) =>
      runtime.localFileContext({ kind: "human", userId: user }, task),
    audit: async (_u, type, data) => {
      events.push({ type, data });
    },
  });
  const windowToken = randomUUID();
  grants.bindWindow(windowToken);
  const transfers = new AutomatedTransfers({
    local: grants,
    locks: new FilePathLocks(),
    audit: async (_ctx, type, data) => {
      events.push({ type, data });
    },
    open: async (_ctx, guard) => ({
      target: {
        key: "fixture",
        connection: sessionId,
        acceptedHostKey: remote.peerKey(),
        io: remote.io,
        check: (_a, _p, canonical) => guard(canonical),
      },
      close: () => {},
      beginWrite: () => () => {},
    }),
  });
  runtime.connectClient(principal.connectionId);
  const automation = new TransferAutomation(runtime, grants, transfers);
  const workflowStore = new Map<string, string>();
  const workflows = new WorkflowLibrary({
    read: (user) => workflowStore.get(user),
    write: async (user, value) => {
      workflowStore.set(user, value);
    },
    ownsHost: async (user, id) => user === userId && id === 7,
    target: () => ({ hostId: 7, groups: [], control: control.snapshot() }),
    policy: () => policy,
    audit: async (_u, type, data) => {
      events.push({ type, data });
    },
    tasks: runtime,
  });
  const core = new McpCore({
    workflows,
    transfers: automation,
    tasks: runtime,
    hosts: async () => [
      { id: 7, name: "fixture", address: "127.0.0.1", port: remote.port },
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
    output: () => ({ text: "", cursor: 0, generation: 1, firstCursor: 0 }),
    open: async () => ({ sessionId }),
  });
  const select = async (taskId: string) => {
    for (const direction of ["upload", "download"] as const) {
      const t = grants.issue(userId, taskId, { windowToken, direction });
      grants.claim(windowToken, t.id);
      await grants.fulfill(windowToken, t.id, [
        direction === "upload" ? source : destination,
      ]);
    }
    return grants.list(userId, taskId);
  };
  const authorize = (taskId: string) =>
    runtime.authorize(human, taskId, {
      ...control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 12,
      durationMinutes: 10,
      allowReviewedPlan: false,
      matches: [{ kind: "program", program: "pwd" }],
      fileScopes: [
        { kind: "directory", path: "/srv", access: ["read", "write"] },
      ],
    });
  const close = async () => {
    control.close();
    transfers.dispose();
    await grants.dispose();
    await remote.close();
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("transfer-tools-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  };
  return {
    remote,
    workflows,
    policy,
    folder,
    source,
    destination,
    bytes,
    runtime,
    principal,
    actor,
    human,
    control,
    grants,
    transfers,
    automation,
    core,
    select,
    authorize,
    writes,
    events,
    sessionId,
    close,
  };
}
