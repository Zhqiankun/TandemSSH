import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { LocalFileBrowser } = require("../electron/local-file-browser.cjs");
const {
  registerLocalFileBrowserIpc,
} = require("../electron/local-file-browser-ipc.cjs");
const {
  registerUploadSourceIpc,
} = require("../electron/upload-source-ipc.cjs");
const { registerDownloadIpc } = require("../electron/download-ipc.cjs");
const { UploadSourceStore } = require("../electron/upload-sources.cjs");
const { DownloadSink } = require("../electron/download-sink.cjs");
const {
  DownloadDirectoryTargets,
} = require("../electron/download-directory-targets.cjs");
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve("../.cache"));
  const dir = await fs.mkdtemp(path.join(cache, "local-browser-test-"));
  cleanup.push(async () => {
    const resolved = await fs.realpath(dir);
    if (
      !resolved.startsWith(cache + path.sep) ||
      !path.basename(resolved).startsWith("local-browser-test-")
    )
      throw Error("Cleanup scope");
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const root = path.join(dir, "本机 root");
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, "中文目录"));
  await fs.writeFile(path.join(root, "配置 ' name.txt"), "source content");
  await fs.writeFile(path.join(root, ".hidden"), "hidden");
  const browser = new LocalFileBrowser(),
    selected = await browser.select(1, root);
  cleanup.push(() => browser.reset(1));
  return { dir, root, browser, selected };
}
it("lists actual local metadata, navigates, filters dotfiles and sorts without reading contents", async () => {
  const f = await fixture();
  const result = await f.browser.list(1, f.selected.id, "", {});
  expect(result.entries.map((e: { name: string }) => e.name)).toEqual([
    "中文目录",
    "配置 ' name.txt",
  ]);
  expect(result.entries[1]).toMatchObject({
    kind: "file",
    size: 14,
    relativePath: "配置 ' name.txt",
  });
  expect(
    (await f.browser.list(1, f.selected.id, "", { showHidden: true })).total,
  ).toBe(3);
  expect(
    (await f.browser.list(1, f.selected.id, "", { search: "name" })).total,
  ).toBe(1);
  expect((await f.browser.list(1, f.selected.id, "中文目录", {})).path).toBe(
    path.join(f.root, "中文目录"),
  );
});
it("paginates complete directory results with stable name ordering", async () => {
  const f = await fixture();
  await Promise.all(
    Array.from({ length: 205 }, (_, n) =>
      fs.writeFile(path.join(f.root, `entry-${n}.txt`), "x"),
    ),
  );
  const first = await f.browser.list(1, f.selected.id, "", {
    search: "entry-",
  });
  const next = await f.browser.list(1, f.selected.id, "", {
    search: "entry-",
    offset: first.nextOffset,
  });
  expect(first.entries).toHaveLength(200);
  expect(next.entries).toHaveLength(5);
  expect(
    new Set([...first.entries, ...next.entries].map((e) => e.name)).size,
  ).toBe(205);
  expect(next.nextOffset).toBeNull();
  expect(first.truncated).toBe(false);
});
it("rejects another owner, path traversal and junction escape while identifying links", async () => {
  const f = await fixture(),
    outside = path.join(f.dir, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "private"), "outside");
  await fs.symlink(
    outside,
    path.join(f.root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(f.browser.list(2, f.selected.id, "", {})).rejects.toThrow(
    "LOCAL_NOT_FOUND",
  );
  for (const name of [
    "../outside",
    "中文目录/../..",
    "C:/",
    "/outside",
    "中文目录\\..",
  ])
    await expect(f.browser.list(1, f.selected.id, name, {})).rejects.toThrow(
      "LOCAL_PATH_INVALID",
    );
  expect(
    (await f.browser.list(1, f.selected.id, "", {})).entries.find(
      (e) => e.name === "link",
    ).kind,
  ).toBe("link");
  await expect(f.browser.list(1, f.selected.id, "link", {})).rejects.toThrow(
    "LOCAL_LINK_BLOCKED",
  );
});
it("detects a replaced root directory and stale selected file before granting upload", async () => {
  const f = await fixture(),
    page = await f.browser.list(1, f.selected.id, "", {}),
    create = vi.fn();
  const file = page.entries.find((e) => e.kind === "file");
  await fs.writeFile(
    path.join(f.root, file.name),
    "external change with different bytes",
  );
  await expect(
    f.browser.withSelection(1, f.selected.id, [file], create, vi.fn()),
  ).rejects.toThrow("LOCAL_ENTRY_CHANGED");
  expect(create).not.toHaveBeenCalled();
  await fs.rename(f.root, path.join(f.dir, "old-root"));
  await fs.mkdir(f.root);
  await expect(f.browser.list(1, f.selected.id, "", {})).rejects.toThrow(
    "LOCAL_ROOT_CHANGED",
  );
});
it("hands selected sources and download folders to existing stores and keeps them after panel release", async () => {
  const f = await fixture(),
    sources = new UploadSourceStore(),
    sink = new DownloadSink(),
    targets = new DownloadDirectoryTargets(sink);
  cleanup.push(async () => {
    sources.reset(1);
    await targets.reset(1);
    await sink.reset(1);
  });
  const page = await f.browser.list(1, f.selected.id, "", {}),
    file = page.entries.find((e) => e.kind === "file");
  const upload = await f.browser.withSelection(
    1,
    f.selected.id,
    [file],
    (paths, guard) => sources.select(1, paths, guard),
    (r) => sources.forget(1, r.id),
  );
  const target = await f.browser.withDirectory(
    1,
    f.selected.id,
    "中文目录",
    (p, guard) => targets.choose(1, async () => p, guard),
    async (r) => {
      await targets.cancel(1, r.id);
      targets.forget(1, r.id);
    },
  );
  f.browser.release(1, f.selected.id);
  expect(
    Buffer.from(
      await sources.chunk(1, upload.id, upload.entries[0].id, 0, 14),
    ).toString(),
  ).toBe("source content");
  const preview = await targets.preview(1, target.id, [
    { id: "new", name: "下载.txt", kind: "file", size: 3 },
  ]);
  expect(preview.path).toBe(path.join(f.root, "中文目录"));
  expect(preview.entries[0].status).toBe("new");
  expect(await fs.readdir(path.join(f.root, "中文目录"))).toEqual([]);
});
it("cleans a newly created transfer grant when the panel is revoked during handoff", async () => {
  const f = await fixture(),
    cleanupGrant = vi.fn();
  const page = await f.browser.list(1, f.selected.id, "", {}),
    file = page.entries.find((e) => e.kind === "file");
  await expect(
    f.browser.withSelection(
      1,
      f.selected.id,
      [file],
      async () => {
        f.browser.release(1, f.selected.id);
        return { id: "new-grant" };
      },
      cleanupGrant,
    ),
  ).rejects.toThrow("LOCAL_CANCELLED");
  expect(cleanupGrant).toHaveBeenCalledWith({ id: "new-grant" });
});
async function ipcFixture() {
  const f = await fixture(),
    appRoot = path.resolve("test-app");
  const frame = {
    url: pathToFileURL(path.join(appRoot, "dist/index.html")).href,
  };
  const sender = Object.assign(new EventEmitter(), {
    id: 77,
    mainFrame: frame,
  });
  const handlers = new Map(),
    ipcMain = { handle: (name, handle) => handlers.set(name, handle) },
    getWindow = () => ({ isDestroyed: () => false, webContents: sender });
  const dialog = {
    showOpenDialog: vi.fn(async () => ({
      canceled: false,
      filePaths: [f.root],
    })),
  };
  const common = { ipcMain, dialog, getWindow, appRoot, isDev: false };
  const uploads = registerUploadSourceIpc(common),
    downloads = registerDownloadIpc({
      ...common,
      shell: { showItemInFolder: vi.fn() },
    });
  const browser = registerLocalFileBrowserIpc({
    ...common,
    uploads,
    downloads,
  });
  cleanup.push(async () => {
    browser.dispose();
    uploads.dispose();
    await downloads.dispose();
  });
  const event = { sender, senderFrame: frame },
    call = (op, ...args) =>
      handlers.get("tandem-local-browser")(event, op, ...args);
  return { ...f, handlers, event, call, sender, dialog, uploads, downloads };
}
it("requires the main frame and registers transferred capabilities in existing window lifetimes", async () => {
  const f = await ipcFixture();
  const denied = await f.handlers.get("tandem-local-browser")(
    { ...f.event, senderFrame: { ...f.event.senderFrame } },
    "choose",
  );
  expect(denied).toMatchObject({
    ok: false,
    error: "LOCAL_TRUSTED_WINDOW_REQUIRED",
  });
  expect(f.dialog.showOpenDialog).not.toHaveBeenCalled();
  const root = (await f.call("choose")).value,
    page = (await f.call("list", root.id, "", {})).value;
  const source = (
    await f.call("upload", root.id, [
      page.entries.find((e) => e.kind === "file"),
    ])
  ).value;
  const target = (await f.call("download", root.id, "")).value;
  expect(source.entries[0].name).toBe("配置 ' name.txt");
  expect(target.path).toBe(f.root);
  f.sender.emit(
    "did-start-navigation",
    {},
    "https://example.invalid",
    false,
    true,
  );
  expect(await f.call("list", root.id, "", {})).toMatchObject({
    ok: false,
    error: "LOCAL_NOT_FOUND",
  });
  await expect(
    f.uploads.sources.check(77, source.id, source.entries[0].id),
  ).rejects.toThrow();
});
it("rejects a directory chooser result arriving after window navigation", async () => {
  const f = await ipcFixture();
  let finish;
  f.dialog.showOpenDialog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = f.call("choose");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.sender.emit(
    "did-start-navigation",
    {},
    "https://example.invalid",
    false,
    true,
  );
  finish({ canceled: false, filePaths: [f.root] });
  expect(await request).toMatchObject({ ok: false, error: "LOCAL_CANCELLED" });
});
