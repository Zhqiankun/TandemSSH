import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { registerDownloadIpc } = require("../electron/download-ipc.cjs");
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("requires the current top frame and revokes directory capabilities on owner reset", async () => {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache"));
  const directory = await fs.mkdtemp(path.join(cache, "directory-ipc-"));
  cleanup.push(async () => {
    const real = await fs.realpath(directory);
    if (
      !real.startsWith(cache + path.sep) ||
      !path.basename(real).startsWith("directory-ipc-")
    )
      throw Error("Cleanup scope");
    await fs.rm(real, { recursive: true, force: true });
  });
  const appRoot = path.resolve("directory-test-app");
  const frame = {
    url: pathToFileURL(path.join(appRoot, "dist/index.html")).href,
  };
  const sender = { id: 41, mainFrame: frame, once: vi.fn(), on: vi.fn() };
  const handlers = new Map<
    string,
    (
      ...args: unknown[]
    ) => Promise<{ ok: boolean; value?: { id: string }; error?: string }>
  >();
  const dialog = {
    showOpenDialog: vi.fn(async () => ({
      canceled: false,
      filePaths: [directory],
    })),
  };
  const api = registerDownloadIpc({
    ipcMain: {
      handle: (
        name: string,
        handler: (...args: unknown[]) => Promise<{ ok: boolean }>,
      ) => handlers.set(name, handler),
    },
    dialog,
    shell: {},
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    appRoot,
    isDev: false,
  });
  cleanup.push(() => api.dispose());
  const invoke = handlers.get("tandem-download-directory")!;
  expect(
    await invoke({ sender, senderFrame: { url: frame.url } }, "choose"),
  ).toMatchObject({ ok: false, error: "DOWNLOAD_TRUSTED_WINDOW_REQUIRED" });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  const event = { sender, senderFrame: frame },
    chosen = await invoke(event, "choose");
  expect(chosen.ok).toBe(true);
  expect(
    await invoke(event, "preview", chosen.value!.id, [
      { id: "f", name: "new", kind: "file", size: 0 },
    ]),
  ).toMatchObject({ ok: true });
  expect(await fs.readdir(directory)).toEqual([]);
  expect(await handlers.get("tandem-download")!(event, "reset")).toMatchObject({
    ok: true,
  });
  expect(
    await invoke(event, "preview", chosen.value!.id, [
      { id: "f", name: "new", kind: "file", size: 0 },
    ]),
  ).toMatchObject({ ok: false, error: "DOWNLOAD_NOT_FOUND" });
});
it("keeps completed downloads intact when revealing fails", async () => {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache"));
  const directory = await fs.mkdtemp(path.join(cache, "directory-ipc-"));
  cleanup.push(async () => {
    const real = await fs.realpath(directory);
    if (
      !real.startsWith(cache + path.sep) ||
      !path.basename(real).startsWith("directory-ipc-")
    )
      throw Error("Cleanup scope");
    await fs.rm(real, { recursive: true, force: true });
  });
  const appRoot = path.resolve("directory-test-app");
  const frame = {
    url: pathToFileURL(path.join(appRoot, "dist/index.html")).href,
  };
  const sender = { id: 41, mainFrame: frame, once: vi.fn(), on: vi.fn() };
  const handlers = new Map<
    string,
    (...args: unknown[]) => Promise<{ ok: boolean; error?: string }>
  >();
  const shell = { showItemInFolder: vi.fn() };
  const api = registerDownloadIpc({
    ipcMain: {
      handle: (
        name: string,
        handler: (...args: unknown[]) => Promise<{ ok: boolean }>,
      ) => handlers.set(name, handler),
    },
    dialog: {},
    shell,
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    appRoot,
    isDev: false,
  });
  cleanup.push(() => api.dispose());
  const event = { sender, senderFrame: frame };
  const invoke = handlers.get("tandem-download")!;
  const target = path.join(directory, "中文 ' $(literal).txt");
  const chosen = await api.sink.choose(
    41,
    {
      name: path.basename(target),
      size: 0,
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      hashes: [],
    },
    async () => target,
  );
  expect(await invoke(event, "show", chosen.id)).toMatchObject({
    ok: false,
    error: "DOWNLOAD_NOT_READY",
  });
  expect(shell.showItemInFolder).not.toHaveBeenCalled();
  await api.sink.start(41, chosen.id, false);
  await api.sink.finish(41, chosen.id);
  expect(await invoke(event, "show", chosen.id)).toMatchObject({ ok: true });
  expect(shell.showItemInFolder).toHaveBeenCalledWith(target);
  shell.showItemInFolder.mockImplementationOnce(() => {
    throw Error("native failure");
  });
  expect(await invoke(event, "show", chosen.id)).toMatchObject({
    ok: false,
    error: "DOWNLOAD_SHOW_FAILED",
  });
  expect(api.sink.owned(41, chosen.id).view.state).toBe("completed");
  await fs.unlink(target);
  shell.showItemInFolder.mockClear();
  expect(await invoke(event, "show", chosen.id)).toMatchObject({
    ok: false,
    error: "DOWNLOAD_SHOW_FAILED",
  });
  expect(shell.showItemInFolder).not.toHaveBeenCalled();
  expect(api.sink.owned(41, chosen.id).view.state).toBe("completed");
  expect(
    await invoke(
      { sender, senderFrame: { url: frame.url } },
      "show",
      chosen.id,
    ),
  ).toMatchObject({ ok: false, error: "DOWNLOAD_TRUSTED_WINDOW_REQUIRED" });
});
