import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url),
  { registerUploadSourceIpc } = require("../electron/upload-source-ipc.cjs"),
  cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    root = await fs.mkdtemp(path.join(cache, "batch-source-ipc-"));
  await fs.writeFile(path.join(root, "source.bin"), "owned");
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== cache ||
      !path.basename(actual).startsWith("batch-source-ipc-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const frame = { url: "file:///E:/app/dist/index.html" },
    sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame }),
    responses = new Map<
      string,
      {
        ok: boolean;
        value?: {
          snapshot: string;
          selection: {
            id: string;
            entries: Array<{ id: string; name: string }>;
          };
        };
        error?: string;
      }
    >(),
    handlers = new Map<
      string,
      (
        ...args: unknown[]
      ) => Promise<{ ok: boolean; value: { id: string; windowToken: string } }>
    >();
  const backend = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn(
      (
        message: {
          type: string;
          requestId: string;
          ok: boolean;
          value?: unknown;
        },
        callback: (e: null) => void,
      ) => {
        callback(null);
        if (message.type === "tandem-upload-recovery-request")
          queueMicrotask(() =>
            backend.emit("message", {
              type: "tandem-upload-recovery-response",
              requestId: message.requestId,
              ok: true,
              value: {},
            }),
          );
        else responses.set(message.requestId, message as never);
      },
    ),
  });
  const bridge = registerUploadSourceIpc({
    ipcMain: { handle: (name: string, fn: never) => handlers.set(name, fn) },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
    },
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    appRoot: "E:/app",
    isDev: false,
    getBackend: () => backend,
  });
  cleanup.push(() => bridge.dispose());
  const invoke = (method: string) =>
    handlers.get("tandem-upload-source")!(
      { sender, senderFrame: frame },
      method,
    );
  const source = await invoke("choose-directory"),
    identity = await invoke("recovery-identity");
  const request = async (method: string, body: object = {}) => {
    const requestId = randomUUID();
    backend.emit("message", {
      type: "tandem-upload-batch-source-request",
      requestId,
      windowToken: identity.value.windowToken,
      sourceId: source.value.id,
      method,
      ...body,
    });
    await vi.waitFor(() => expect(responses.has(requestId)).toBe(true));
    return responses.get(requestId)!;
  };
  return { root, source, identity, invoke, request, sender, bridge };
}
it("transfers a source checkpoint only for the bound native window", async () => {
  const f = await fixture(),
    r = await f.request("snapshot");
  expect(r.ok).toBe(true);
  expect(
    JSON.parse(r.value!.snapshot).entries.some(
      (e: { view: { name: string } }) => e.view.name === "source.bin",
    ),
  ).toBe(true);
  const wrong = await f.request("snapshot", { windowToken: randomUUID() });
  expect(wrong).toMatchObject({
    ok: false,
    error: "UPLOAD_RECOVERY_WINDOW_CLOSED",
  });
});
it("restores only members from the saved source after a fresh native directory selection", async () => {
  const f = await fixture(),
    saved = await f.request("snapshot");
  await fs.writeFile(path.join(f.root, "new.bin"), "new");
  const selected = await f.invoke("choose-directory"),
    r = await f.request("restore", {
      sourceId: selected.value.id,
      snapshot: saved.value!.snapshot,
    });
  expect(r.ok).toBe(true);
  const value = r.value as unknown as { entries: Array<{ name: string }> };
  expect(value.entries.some((e) => e.name === "source.bin")).toBe(true);
  expect(value.entries.some((e) => e.name === "new.bin")).toBe(false);
});
it("revokes the private source channel when the renderer exits", async () => {
  const f = await fixture();
  f.sender.emit("render-process-gone");
  const r = await f.request("snapshot");
  expect(r).toMatchObject({
    ok: false,
    error: "UPLOAD_RECOVERY_WINDOW_CLOSED",
  });
});
