import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { UploadSourceStore } = require("../electron/upload-sources.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    directory = await fs.mkdtemp(path.join(cache, "native-upload-source-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(directory);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("native-upload-source-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const store = new UploadSourceStore();
  cleanup.push(() => store.reset(1));
  return { directory, store };
}
describe("native upload source capabilities", () => {
  it("enumerates nested files and empty directories and reads exact owned bytes", async () => {
    const f = await fixture(),
      root = path.join(f.directory, "项目");
    await fs.mkdir(path.join(root, "空目录"), { recursive: true });
    await fs.writeFile(
      path.join(root, "data.bin"),
      Buffer.from([0, 1, 255, 8]),
    );
    const selected = await f.store.select(1, [root]);
    expect(
      selected.entries
        .map((e: { relativePath: string }) => e.relativePath)
        .sort(),
    ).toEqual(["项目", "项目/空目录", "项目/data.bin"].sort());
    const file = selected.entries.find(
      (e: { kind: string }) => e.kind === "file",
    );
    expect([...(await f.store.chunk(1, selected.id, file.id, 1, 2))]).toEqual([
      1, 255,
    ]);
    await expect(f.store.chunk(2, selected.id, file.id, 0, 1)).rejects.toThrow(
      "UPLOAD_SOURCE_NOT_FOUND",
    );
    f.store.forget(1, selected.id);
    await expect(f.store.check(1, selected.id, file.id)).rejects.toThrow(
      "UPLOAD_SOURCE_NOT_FOUND",
    );
  });
  it("excludes a junction instead of collecting its target", async () => {
    const f = await fixture(),
      root = path.join(f.directory, "root"),
      other = path.join(f.directory, "other");
    await fs.mkdir(root);
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, "secret"), "hidden");
    await fs.symlink(
      other,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const selected = await f.store.select(1, [root]);
    expect(selected.entries).toHaveLength(2);
    expect(selected.excluded).toBe(1);
    expect(selected.entries[1]).toMatchObject({
      kind: "link",
      error: "UPLOAD_SOURCE_LINK_OR_SPECIAL",
    });
  });
  it("detects file replacement and revokes reads on reset", async () => {
    const f = await fixture(),
      file = path.join(f.directory, "file");
    await fs.writeFile(file, "before");
    const selected = await f.store.select(1, [file]),
      entry = selected.entries[0];
    await fs.writeFile(file, "changed source");
    await expect(f.store.chunk(1, selected.id, entry.id, 0, 1)).rejects.toThrow(
      "UPLOAD_SOURCE_CHANGED",
    );
    f.store.reset(1);
    await expect(f.store.check(1, selected.id, entry.id)).rejects.toThrow(
      "UPLOAD_SOURCE_NOT_FOUND",
    );
  });
  it("checks empty files without requiring a data chunk and bounds read sizes", async () => {
    const f = await fixture(),
      file = path.join(f.directory, "empty");
    await fs.writeFile(file, "");
    const selected = await f.store.select(1, [file]),
      entry = selected.entries[0];
    expect((await f.store.check(1, selected.id, entry.id)).size).toBe(0);
    await expect(
      f.store.chunk(1, selected.id, entry.id, 0, 4194305),
    ).rejects.toThrow("UPLOAD_CHUNK_INVALID");
    await fs.writeFile(file, "now nonempty");
    await expect(f.store.check(1, selected.id, entry.id)).rejects.toThrow(
      "UPLOAD_SOURCE_CHANGED",
    );
  });
  it("keeps raw-path selection off the generic preload bridge", async () => {
    const exposed = new Map<string, unknown>(),
      invoke = vi.fn(async () => ({ ok: true }));
    const realFile = { selected: true },
      nativePath = path.resolve("selected-folder");
    const script = await fs.readFile(
      path.resolve("electron/preload.js"),
      "utf8",
    );
    const context = {
      window: {},
      process: { env: {} },
      require: (name: string) => {
        if (name !== "electron") throw Error("Unexpected module");
        return {
          contextBridge: {
            exposeInMainWorld: (name: string, value: unknown) =>
              exposed.set(name, value),
          },
          ipcRenderer: { invoke },
          webUtils: {
            getPathForFile: (file: unknown) =>
              file === realFile ? nativePath : "",
          },
        };
      },
    };
    vm.runInNewContext(script, context);
    const api = exposed.get("electronAPI") as {
      invoke: (channel: unknown, ...args: unknown[]) => unknown;
      uploadSources: { fromFiles: (files: unknown[]) => Promise<unknown> };
    };
    expect(() =>
      api.invoke("tandem-upload-source", "selected-files", ["C:/private"]),
    ).toThrow("UPLOAD_SOURCE_CHANNEL_PRIVATE");
    expect(() => api.uploadSources.fromFiles(["C:/private"])).toThrow(
      "UPLOAD_SOURCE_INVALID",
    );
    expect(invoke).not.toHaveBeenCalled();
    await api.uploadSources.fromFiles([realFile]);
    expect(invoke).toHaveBeenCalledWith(
      "tandem-upload-source",
      "selected-files",
      [nativePath],
    );
  });
});
