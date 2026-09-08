import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  LocalFileGrants,
  type LocalTaskIdentity,
  type NativeTaskLocalFiles,
} from "../src/backend/files/local-file-grants";
import { registerLocalFileBridge } from "../src/backend/files/local-file-bridge";
const require = createRequire(import.meta.url),
  { TaskLocalFiles } = require("../electron/task-local-files.cjs"),
  {
    registerTaskLocalFilesIpc,
  } = require("../electron/task-local-files-ipc.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "native-local-grants-")),
    file = path.join(folder, "来源.bin");
  await fs.writeFile(file, "selected bytes");
  cleanup.push(async () => {
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("native-local-grants-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const context: LocalTaskIdentity = {
    userId: "owner",
    taskId: randomUUID(),
    sessionId: randomUUID(),
    hostId: 1,
    hostName: "fixture",
    title: "选择测试",
    state: "ready",
    control: { generation: 1, controlEpoch: 1 },
  };
  const native: NativeTaskLocalFiles = new TaskLocalFiles(),
    service = new LocalFileGrants({
      available: () => true,
      native: () => native,
      context: () => context,
      audit: async () => {},
    });
  cleanup.push(() => service.dispose());
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: (message: unknown, callback: (error: null) => void) => {
      queueMicrotask(() => {
        backend.emit("message", message);
        callback(null);
      });
    },
  });
  const backend = Object.assign(new EventEmitter(), {
    send: (message: unknown, callback: (error: null) => void) => {
      queueMicrotask(() => {
        child.emit("message", message);
        callback(null);
      });
    },
  });
  const disposeBridge = registerLocalFileBridge(service, backend);
  cleanup.push(disposeBridge);
  const sender = Object.assign(new EventEmitter(), {
      id: 1,
      mainFrame: {
        url: pathToFileURL(path.resolve(folder, "dist/index.html")).href,
      },
    }),
    event = { sender, senderFrame: sender.mainFrame };
  const handlers = new Map<
    string,
    (
      ...args: unknown[]
    ) => Promise<{ ok: boolean; value?: unknown; error?: string }>
  >();
  const dialog = {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [file] })),
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: path.join(folder, "下载.bin"),
    })),
  };
  const main = registerTaskLocalFilesIpc({
    ipcMain: {
      handle: (
        name: string,
        handler: (
          ...args: unknown[]
        ) => Promise<{ ok: boolean; value?: unknown; error?: string }>,
      ) => handlers.set(name, handler),
    },
    dialog,
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    getBackend: () => child,
    appRoot: folder,
    isDev: false,
  });
  cleanup.push(() => main.dispose());
  const invoke = (op: string, id?: string, e: unknown = event) =>
    handlers.get("tandem-task-local-files")!(e, op, id);
  const identity = await invoke("identity");
  expect(identity.ok).toBe(true);
  const token = (identity.value as { windowToken: string }).windowToken;
  const ticket = (direction: "upload" | "download" = "upload") =>
    service.issue("owner", context.taskId, { windowToken: token, direction });
  return {
    folder,
    file,
    context,
    native,
    service,
    child,
    backend,
    sender,
    event,
    dialog,
    invoke,
    token,
    ticket,
  };
}
it("redeems the exact native picker result over the private backend channel", async () => {
  const f = await fixture(),
    ticket = f.ticket(),
    result = await f.invoke("choose", ticket.id);
  expect(result.ok).toBe(true);
  expect(f.service.humanList("owner", f.context.taskId)[0].path).toBe(f.file);
  expect(f.dialog.showOpenDialog).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      title: "选择本任务的上传来源",
      properties: ["openFile", "multiSelections"],
    }),
  );
  const again = await f.invoke("choose", ticket.id);
  expect(again.ok).toBe(false);
  expect(f.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
});
it("rejects an iframe and arbitrary renderer operations without opening the picker", async () => {
  const f = await fixture();
  expect(
    (
      await f.invoke("identity", undefined, {
        ...f.event,
        senderFrame: { url: f.sender.mainFrame.url },
      })
    ).error,
  ).toBe("FILE_LOCAL_TRUSTED_WINDOW_REQUIRED");
  expect((await f.invoke("fulfill", randomUUID())).error).toBe(
    "FILE_LOCAL_REQUEST_INVALID",
  );
  expect(f.dialog.showOpenDialog).not.toHaveBeenCalled();
});
it("a reset waits for backend revocation and rejects a late picker response", async () => {
  const f = await fixture();
  let release!: (value: { canceled: boolean; filePaths: string[] }) => void;
  f.dialog.showOpenDialog.mockImplementation(
    () => new Promise((r) => (release = r)),
  );
  const ticket = f.ticket(),
    work = f.invoke("choose", ticket.id);
  await vi.waitFor(() =>
    expect(f.dialog.showOpenDialog).toHaveBeenCalledOnce(),
  );
  expect((await f.invoke("reset")).ok).toBe(true);
  release({ canceled: false, filePaths: [f.file] });
  expect((await work).error).toBe("FILE_LOCAL_WINDOW_CLOSED");
  expect(f.service.list("owner", f.context.taskId)).toEqual([]);
  expect(() => f.service.claim(f.token, ticket.id)).toThrow(
    "FILE_LOCAL_TICKET_INVALID",
  );
});
it("does not grant anything when a native picker is cancelled", async () => {
  const f = await fixture();
  f.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: "" });
  const ticket = f.ticket("download");
  expect(await f.invoke("choose", ticket.id)).toEqual({
    ok: true,
    value: null,
  });
  expect(f.service.list("owner", f.context.taskId)).toEqual([]);
});
it("allows a window-close revocation even while request admission is full", async () => {
  const f = await fixture(),
    pending: Array<() => void> = [];
  vi.spyOn(f.service, "fulfill").mockImplementation(
    () => new Promise((r) => pending.push(() => r({ grants: [] }))),
  );
  const responses: unknown[] = [];
  f.child.on("message", (message) => responses.push(message));
  for (let i = 0; i < 8; i++)
    f.backend.emit("message", {
      type: "tandem-local-files-request",
      requestId: randomUUID(),
      windowToken: f.token,
      method: "fulfill",
      ticketId: randomUUID(),
      paths: [f.file],
    });
  await vi.waitFor(() => expect(pending).toHaveLength(8));
  const requestId = randomUUID();
  f.backend.emit("message", {
    type: "tandem-local-files-request",
    requestId,
    windowToken: f.token,
    method: "close",
  });
  await vi.waitFor(() =>
    expect(responses).toContainEqual(
      expect.objectContaining({ requestId, ok: true }),
    ),
  );
  pending.forEach((release) => release());
});
