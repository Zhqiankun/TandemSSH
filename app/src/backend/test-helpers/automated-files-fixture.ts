import { posix } from "node:path";
import type { CommandPolicySnapshot } from "../../types/collaboration-operations";
import { expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DocumentService, DocumentError } from "../files/document-service";
import { AutomatedDocuments } from "../files/automated-documents";
import { FileAutomation } from "../collaboration/files/automation";
import { TaskRuntime, type TaskActor } from "../collaboration/tasks/runtime";
import { SessionControl } from "../collaboration/sessions/control";
import { McpCore } from "../mcp/core";

import type { RemoteFileIO, RemoteFileSnapshot } from "../files/ports";
export function automatedFilesFixture(
  content = "port=80\n",
  mode: "automatic" | "collaborative" = "automatic",
  options: {
    audit?: (type: string, data: unknown) => Promise<void>;
    policy?: CommandPolicySnapshot;
  } = {},
) {
  const sessionId = randomUUID(),
    userId = "owner",
    clientId = randomUUID(),
    connectionId = randomUUID(),
    principal = {
      userId,
      clientId,
      connectionId,
      allowedHostIds: [7],
      readTerminal: true,
    };
  const actor: TaskActor = { kind: "mcp", ...principal },
    human: TaskActor = { kind: "human", userId };
  const rows = new Map<string, RemoteFileSnapshot>(),
    events: unknown[] = [],
    writes: string[] = [],
    opened: string[] = [];
  const put = (path: string, text: string) => {
    const bytes = Buffer.from(text);
    rows.set(path, {
      bytes,
      stat: {
        size: bytes.length,
        mtime: 100,
        atime: 100,
        mode: 0o100640,
        uid: 1000,
        gid: 1000,
        kind: "file",
      },
    });
  };
  put("/srv/config", content);
  const io: RemoteFileIO = {
    resolve: async (path) => path,
    stat: async (path) => {
      const row = rows.get(path);
      if (!row) {
        if (
          [...rows.keys()].some((key) =>
            key.startsWith(path.replace(/\/$/, "") + "/"),
          )
        )
          return {
            size: 0,
            mtime: 100,
            atime: 100,
            mode: 0o40755,
            uid: 1000,
            gid: 1000,
            kind: "directory" as const,
          };
        throw new DocumentError("FILE_NOT_FOUND");
      }
      return { ...row.stat };
    },
    list: async (path, _max, guard) => {
      guard();
      const names = new Set(
        [...rows.keys()]
          .filter((key) => key.startsWith(path + "/"))
          .map((key) => key.slice(path.length + 1).split("/")[0]),
      );
      return Promise.all(
        [...names].map(async (name) => ({
          name,
          stat: await io.stat(posix.join(path, name)),
        })),
      );
    },
    snapshot: async (path, max, guard) => {
      guard?.();
      const row = rows.get(path);
      if (!row) throw new DocumentError("FILE_NOT_FOUND");
      if (row.bytes.length > max) throw Error("FILE_TOO_LARGE");
      return { bytes: Buffer.from(row.bytes), stat: { ...row.stat } };
    },
    createExclusive: async (path, bytes, meta, guard) => {
      guard();
      if (rows.has(path)) throw Error("FILE_ALREADY_EXISTS");
      put(path, bytes.toString());
      if (meta)
        Object.assign(rows.get(path)!.stat, {
          uid: meta.uid,
          gid: meta.gid,
          mode: meta.mode,
        });
    },
    replace: async (from, to, overwrite, guard) => {
      guard();
      if (!overwrite && rows.has(to))
        throw new DocumentError("FILE_ALREADY_EXISTS", {
          commitMayHaveOccurred: false,
        });
      rows.set(to, rows.get(from)!);
      rows.delete(from);
      return { atomic: true };
    },
  };
  const docs = new DocumentService({
    target: async (a) => {
      if (!a.access) throw Error("MISSING_CAPABILITY");
      return a.access;
    },
    audit: async (a, type, data) => {
      events.push({ source: a.source, type, data });
    },
    beginWrite: () => () => {},
  });
  const store = new AutomatedDocuments(docs, {
    open: async (a, id, guard, signal) => {
      opened.push(id);
      let closed = false;
      return {
        access: {
          key: "host",
          connection: "connection",
          hostScope: { userId, hostId: 7, identity: "owner@fixture:22" },
          io,
          retain: () => () => {},
          check: (_access, _requested, canonical) => {
            if (closed || signal.aborted) throw Error("FILE_REQUEST_CANCELLED");
            guard(canonical);
          },
        },
        close: () => {
          closed = true;
        },
      };
    },
  });
  const control = new SessionControl(
    sessionId,
    {
      isReady: () => true,
      write: (bytes) => writes.push(Buffer.from(bytes).toString()),
    },
    () => {},
  );
  const runtime = new TaskRuntime({
    fileReviewValid: (...args) => store.validReview(...args),
    getSession: (id) =>
      id === sessionId
        ? {
            id: sessionId,
            userId,
            hostId: 7,
            hostName: "owner@fixture:22",
            groups: () => [],
            control,
            files: store.executor(userId, sessionId),
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
              prepare: async () => {
                throw Error("NO_COMMAND_EXPECTED");
              },
            },
          }
        : null,
    policy: async () => options.policy ?? { revision: 1, sets: [] },
    audit: () => ({
      append: async (e) => {
        events.push(e);
      },
      record: async (type, data) => {
        events.push({ type, data });
        await options.audit?.(type, data);
      },
    }),
  });
  runtime.connectClient(connectionId);
  const files = new FileAutomation(runtime, store),
    core = new McpCore({
      files,
      tasks: runtime,
      hosts: async () => [],
      sessions: () => [],
      output: () => ({ text: "", cursor: 0, generation: 1, firstCursor: 0 }),
      open: async () => {
        throw Error("NO_NEW_CONNECTION");
      },
    });
  const call = (
    method: Parameters<McpCore["invoke"]>[1],
    data: Record<string, unknown>,
  ) => core.invoke(principal, method, data, new AbortController().signal);
  const start = async () => {
    const task = await runtime.create(actor, {
      sessionId,
      requestId: randomUUID(),
      title: "文件任务",
      mode,
    });
    await runtime.authorize(human, task.id, {
      ...control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 20,
      durationMinutes: 10,
      allowReviewedPlan: false,
      matches: [],
      fileScopes: [
        { kind: "directory", path: "/srv", access: ["read", "write"] },
      ],
    });
    return task.id;
  };
  const wait = async (taskId: string, operationId: string, status: string) => {
    await vi.waitFor(() =>
      expect(runtime.operation(actor, taskId, operationId).status).toBe(status),
    );
    return runtime.operation(actor, taskId, operationId);
  };
  const read = async (taskId: string) => {
    const result = await files.read(
      actor,
      taskId,
      { path: "/srv/config" },
      randomUUID(),
    );
    if (mode === "collaborative") {
      const op = await wait(taskId, result.operationId, "awaiting-approval");
      expect(opened).toHaveLength(0);
      await runtime.approve(human, taskId, op.id, op.digest, 1);
    }
    const op = await wait(taskId, result.operationId, "succeeded");
    return op.fileResult!.document!.version;
  };
  return {
    close: () => {
      control.close();
      store.dispose();
      docs.dispose();
    },
    start,
    read,
    wait,
    call,
    runtime,
    control,
    store,
    files,
    actor,
    human,
    rows,
    put,
    events,
    writes,
    opened,
    io,
  };
}
