import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const {
  registerUploadSourceIpc,
} = require("../electron/upload-source-ipc.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("requires the real main frame and revokes selected source IDs on reset", async () => {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    dir = await fs.mkdtemp(path.join(cache, "upload-source-ipc-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(dir);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("upload-source-ipc-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "file"), "data");
  const appRoot = path.resolve("test-app"),
    frame = { url: pathToFileURL(path.join(appRoot, "dist/index.html")).href },
    sender = {
      id: 44,
      mainFrame: undefined as unknown,
      once: vi.fn(),
      on: vi.fn(),
    };
  sender.mainFrame = frame;
  const handlers = new Map(),
    dialog = {
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: [dir],
      })),
    };
  const api = registerUploadSourceIpc({
    ipcMain: { handle: (key: string, fn: unknown) => handlers.set(key, fn) },
    dialog,
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    appRoot,
    isDev: false,
  });
  cleanup.push(() => api.dispose());
  const invoke = handlers.get("tandem-upload-source");
  expect(
    await invoke(
      { sender, senderFrame: { url: frame.url } },
      "choose-directory",
    ),
  ).toMatchObject({ ok: false, error: "UPLOAD_TRUSTED_WINDOW_REQUIRED" });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  const event = { sender, senderFrame: frame },
    selected = await invoke(event, "choose-directory");
  expect(selected.ok).toBe(true);
  const entry = selected.value.entries.find(
    (e: { kind: string }) => e.kind === "file",
  );
  expect(
    await invoke(event, "chunk", selected.value.id, entry.id, 0, 4),
  ).toMatchObject({ ok: true });
  expect(await invoke(event, "reset")).toMatchObject({ ok: true });
  expect(
    await invoke(event, "check", selected.value.id, entry.id),
  ).toMatchObject({ ok: false, error: "UPLOAD_SOURCE_NOT_FOUND" });
});
