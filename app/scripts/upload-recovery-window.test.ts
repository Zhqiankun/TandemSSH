import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { registerUploadSourceIpc } = require("../electron/upload-source-ipc.cjs");
const close: Array<() => void> = [];
afterEach(() => {
  for (const fn of close.splice(0)) fn();
});
function fixture() {
  const handlers = new Map<
      string,
      (
        ...args: unknown[]
      ) => Promise<{
        ok: boolean;
        value?: { windowToken?: string };
        error?: string;
      }>
    >(),
    sender = Object.assign(new EventEmitter(), {
      id: 7,
      mainFrame: { url: "file:///E:/app/dist/index.html" },
    }),
    backend = Object.assign(new EventEmitter(), {
      connected: true,
      send: vi.fn(
        (
          request: { requestId: string; method: string; windowToken: string },
          callback: (e: null) => void,
        ) => {
          callback(null);
          queueMicrotask(() =>
            backend.emit("message", {
              type: "tandem-upload-recovery-response",
              requestId: request.requestId,
              ok: true,
              value: { done: true },
            }),
          );
        },
      ),
    });
  const ipc = registerUploadSourceIpc({
    ipcMain: {
      handle: (
        name: string,
        fn: (...a: unknown[]) => Promise<{ ok: boolean }>,
      ) => handlers.set(name, fn),
    },
    dialog: {},
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    appRoot: "E:/app",
    isDev: false,
    getBackend: () => backend,
  });
  close.push(() => ipc.dispose());
  return {
    backend,
    sender,
    invoke: (operation: string, frame = sender.mainFrame) =>
      handlers.get("tandem-upload-source")!(
        { sender, senderFrame: frame },
        operation,
      ),
  };
}
it("binds one token to the trusted frame and revokes it on reset", async () => {
  const f = fixture(),
    first = await f.invoke("recovery-identity"),
    same = await f.invoke("recovery-identity");
  expect(first.ok).toBe(true);
  expect(same.value?.windowToken).toBe(first.value?.windowToken);
  await f.invoke("reset");
  const next = await f.invoke("recovery-identity");
  expect(next.value?.windowToken).not.toBe(first.value?.windowToken);
  expect(f.backend.send.mock.calls.map(([r]) => r.method)).toEqual([
    "bind",
    "close",
    "bind",
  ]);
});
it("rejects an untrusted frame before any backend registration", async () => {
  const f = fixture();
  expect(
    (await f.invoke("recovery-identity", { url: f.sender.mainFrame.url })).ok,
  ).toBe(false);
  expect(f.backend.send).not.toHaveBeenCalled();
});
