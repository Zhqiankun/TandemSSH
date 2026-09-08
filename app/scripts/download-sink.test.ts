import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const { DownloadSink, CHUNK_BYTES } = require("../electron/download-sink.cjs");
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const spec = (b: Buffer) => ({
  name: "下载.bin",
  size: b.length,
  sha256: sha(b),
  hashes: Array.from({ length: Math.ceil(b.length / CHUNK_BYTES) }, (_, i) =>
    sha(b.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)),
  ),
});
async function fixture(bytes = Buffer.from("download")) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tandem-download-"));
  cleanup.push(() => fs.rm(dir, { recursive: true, force: true }));
  const sink = new DownloadSink();
  cleanup.push(() => sink.reset(1));
  const target = path.join(dir, "下载.bin"),
    choose = () => sink.choose(1, spec(bytes), async () => target);
  return { sink, dir, target, choose, bytes };
}
describe("native download destination", () => {
  it("writes blocks, accepts only matching retries, pauses and resumes, then verifies the actual file", async () => {
    const f = await fixture(Buffer.alloc(CHUNK_BYTES + 23, 192)),
      chosen = await f.choose();
    await f.sink.start(1, chosen.id, false);
    await expect(fs.stat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
    const first = f.bytes.subarray(0, CHUNK_BYTES);
    await f.sink.append(1, chosen.id, 0, first);
    await f.sink.append(1, chosen.id, 0, first);
    await f.sink.pause(1, chosen.id);
    expect((await f.sink.resume(1, chosen.id)).writtenBytes).toBe(CHUNK_BYTES);
    await f.sink.append(
      1,
      chosen.id,
      CHUNK_BYTES,
      f.bytes.subarray(CHUNK_BYTES),
    );
    const result = await f.sink.finish(1, chosen.id);
    expect(result.state).toBe("completed");
    expect(result.sha256).toBe(sha(f.bytes));
    expect((await fs.readFile(f.target)).equals(f.bytes)).toBe(true);
    expect(result.temporaryPath).toBeUndefined();
  });
  it("does not overwrite an existing destination until explicitly authorized", async () => {
    const f = await fixture();
    await fs.writeFile(f.target, "old");
    const chosen = await f.choose();
    await expect(f.sink.start(1, chosen.id, false)).rejects.toThrow(
      "DOWNLOAD_OVERWRITE_REQUIRED",
    );
    expect(await fs.readFile(f.target, "utf8")).toBe("old");
    const approved = await f.choose();
    await f.sink.start(1, approved.id, true);
    await f.sink.append(1, approved.id, 0, f.bytes);
    await f.sink.finish(1, approved.id);
    expect(await fs.readFile(f.target)).toEqual(f.bytes);
  });
  it("preserves a target changed after review", async () => {
    const f = await fixture();
    await fs.writeFile(f.target, "old");
    const chosen = await f.choose();
    await f.sink.start(1, chosen.id, true);
    await f.sink.append(1, chosen.id, 0, f.bytes);
    await fs.writeFile(f.target, "new external data");
    await expect(f.sink.finish(1, chosen.id)).rejects.toThrow(
      "DOWNLOAD_TARGET_CHANGED",
    );
    expect(await fs.readFile(f.target, "utf8")).toBe("new external data");
  });
  it("refuses a modified local checkpoint", async () => {
    const f = await fixture(),
      chosen = await f.choose();
    await f.sink.start(1, chosen.id, false);
    const part = await f.sink.append(1, chosen.id, 0, f.bytes);
    await f.sink.pause(1, chosen.id);
    await fs.writeFile(part.temporaryPath, "tampered");
    await expect(f.sink.resume(1, chosen.id)).rejects.toThrow(
      "DOWNLOAD_CHECKPOINT_CHANGED",
    );
  });
  it("handles empty files and cancels only owned temporary files", async () => {
    const f = await fixture(Buffer.alloc(0)),
      chosen = await f.choose();
    await f.sink.start(1, chosen.id, false);
    const complete = await f.sink.finish(1, chosen.id);
    expect(complete.state).toBe("completed");
    expect((await fs.stat(f.target)).size).toBe(0);
    const another = await f.choose();
    expect(() => f.sink.start(2, another.id, true)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    await f.sink.start(1, another.id, true);
    const cancelled = await f.sink.cancel(1, another.id);
    expect(cancelled.temporaryPath).toBeUndefined();
    expect((await fs.stat(f.target)).size).toBe(0);
  });
  it("prevents a renderer frame from choosing an arbitrary target without a native dialog", async () => {
    const { registerDownloadIpc } = require("../electron/download-ipc.cjs");
    const handlers = new Map(),
      frame = { url: "file:///E:/app/dist/index.html" },
      sender = {
        id: 7,
        mainFrame: undefined as unknown,
        once: vi.fn(),
        on: vi.fn(),
      };
    sender.mainFrame = frame;
    const dialog = { showSaveDialog: vi.fn() };
    const api = registerDownloadIpc({
      ipcMain: { handle: (key: string, fn: unknown) => handlers.set(key, fn) },
      dialog,
      shell: {},
      getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
      appRoot: "E:/app",
      isDev: false,
    });
    cleanup.push(() => api.dispose());
    expect(
      (
        await handlers.get("tandem-download")(
          { sender, senderFrame: { url: frame.url } },
          "choose",
          spec(Buffer.from("a")),
        )
      ).ok,
    ).toBe(false);
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });
});
