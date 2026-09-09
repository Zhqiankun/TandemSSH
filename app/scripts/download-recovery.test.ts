import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { DownloadService } from "../src/backend/files/download-service";
import { fileSftpFixture } from "../src/backend/test-helpers/file-sftp-fixture";
const require = createRequire(import.meta.url),
  { DownloadSink, CHUNK_BYTES } = require("../electron/download-sink.cjs");
const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const spec = (bytes: Buffer) => ({
  name: "download.bin",
  size: bytes.length,
  sha256: hash(bytes),
  hashes: Array.from(
    { length: Math.ceil(bytes.length / CHUNK_BYTES) },
    (_, i) => hash(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)),
  ),
});
async function fixture(
  bytes = Buffer.alloc(CHUNK_BYTES + 37, 47),
  fill = true,
) {
  const cache = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.cache",
  );
  await fs.mkdir(cache, { recursive: true });
  const root = await fs.mkdtemp(path.join(cache, "download-recovery-"));
  closes.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== (await fs.realpath(cache)) ||
      !path.basename(actual).startsWith("download-recovery-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const sink = new DownloadSink();
  closes.push(() => sink.reset("old"));
  const target = path.join(root, "download.bin"),
    chosen = await sink.choose("old", spec(bytes), async () => target);
  await sink.start("old", chosen.id, false);
  if (fill) {
    await sink.append(
      "old",
      chosen.id,
      0,
      bytes.subarray(0, Math.min(bytes.length, CHUNK_BYTES)),
    );
    await sink.pause("old", chosen.id);
  }
  return {
    root,
    cache,
    sink,
    chosen,
    target,
    bytes,
    checkpoint: async () => {
      let data: unknown;
      await sink.suspend("old", chosen.id, async (c: unknown) => {
        data = JSON.parse(JSON.stringify(c));
      });
      return data as {
        id: string;
        stagePath: string;
        writtenBytes: number;
        [key: string]: unknown;
      };
    },
  };
}
it("continues real SSH/SFTP bytes in a new process after the original instances are gone", async () => {
  const f = await fixture(Buffer.alloc(CHUNK_BYTES + 37, 47), false),
    remote = await fileSftpFixture();
  closes.push(() => remote.close());
  await remote.write("/download.bin", f.bytes);
  const source = new DownloadService({
    target: async () => ({
      key: "fixture-key",
      connection: "old-connection",
      acceptedHostKey: remote.peerKey(),
      hostScope: { userId: "owner", identity: "fixture" },
      io: remote.io,
      check: () => {},
    }),
    audit: async () => {},
  });
  closes.push(async () => source.dispose());
  const preview = await source.prepare(
    { userId: "owner" },
    {
      sessionId: "old-session",
      requestId: randomUUID(),
      path: "/download.bin",
    },
  );
  await f.sink.append(
    "old",
    f.chosen.id,
    0,
    await source.chunk({ userId: "owner" }, preview.id, 0),
  );
  await f.sink.pause("old", f.chosen.id);
  await source.pause({ userId: "owner" }, preview.id);
  const sourceCheckpoint = source.checkpoint({ userId: "owner" }, preview.id),
    localCheckpoint = await f.checkpoint(),
    checkpointFile = path.join(f.root, "checkpoint.json");
  await fs.writeFile(
    checkpointFile,
    JSON.stringify({ source: sourceCheckpoint, local: localCheckpoint }),
    { mode: 0o600 },
  );
  source.dispose();
  await f.sink.reset("old");
  expect(() => source.get({ userId: "owner" }, preview.id)).toThrow(
    "DOWNLOAD_NOT_FOUND",
  );
  expect(() => f.sink.owned("old", f.chosen.id)).toThrow("DOWNLOAD_NOT_FOUND");
  const worker = fileURLToPath(
    new URL("./test-helpers/download-recovery-worker.mjs", import.meta.url),
  );
  const result = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", worker],
      {
        cwd: path.resolve(path.dirname(worker), "../.."),
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error ? reject(Error(stderr || error.message)) : resolve(stdout),
    );
    child.stdin!.end(
      JSON.stringify({
        root: f.root,
        cache: f.cache,
        checkpointFile,
        credentials: remote.credentials(),
        peer: remote.peerKey(),
      }),
    );
  });
  expect(JSON.parse(result)).toMatchObject({
    state: "completed",
    sha256: hash(f.bytes),
    resumedAt: CHUNK_BYTES,
    newCapabilities: true,
    realNewProcess: true,
  });
  expect((await fs.readFile(f.target)).equals(f.bytes)).toBe(true);
}, 30000);
it("keeps the current capability and partial bytes when checkpoint persistence fails", async () => {
  const f = await fixture();
  await expect(
    f.sink.suspend("old", f.chosen.id, async () => {
      throw Error("disk failure");
    }),
  ).rejects.toThrow();
  expect(f.sink.owned("old", f.chosen.id).view.temporaryPath).toBeTruthy();
  expect(
    (
      await fs.readFile(f.sink.owned("old", f.chosen.id).view.temporaryPath)
    ).equals(f.bytes.subarray(0, CHUNK_BYTES)),
  ).toBe(true);
  await f.sink.resume("old", f.chosen.id);
});
it("does not delete a persisted partial if the owner resets during the handoff", async () => {
  const f = await fixture();
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => {
      started = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  let checkpoint: { stagePath: string } | undefined;
  const pending = f.sink.suspend("old", f.chosen.id, async (c: unknown) => {
    checkpoint = c as { stagePath: string };
    started();
    await wait;
  });
  await entered;
  const reset = f.sink.reset("old");
  release();
  await pending;
  await reset;
  expect((await fs.stat(checkpoint!.stagePath)).size).toBe(CHUNK_BYTES);
});
it("requires a new guard, refuses concurrent restore and preserves unconfirmed tails until resume", async () => {
  const f = await fixture(),
    checkpoint = await f.checkpoint(),
    sink = new DownloadSink();
  closes.push(() => sink.reset("new"));
  await fs.appendFile(checkpoint.stagePath, "tail");
  await expect(sink.restore("new", checkpoint, {})).rejects.toThrow(
    "DOWNLOAD_RECOVERY_AUTHORIZATION_REQUIRED",
  );
  const options = {
    overwrite: false,
    source: spec(f.bytes),
    authorize: () => {},
  };
  await expect(
    sink.restore("new", checkpoint, {
      ...options,
      source: { ...spec(f.bytes), sha256: "0".repeat(64) },
    }),
  ).rejects.toThrow("DOWNLOAD_CHECKPOINT_SOURCE_MISMATCH");
  const results = await Promise.allSettled([
    sink.restore("new", checkpoint, options),
    sink.restore("new", checkpoint, options),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const restored = (
    results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
      recovery: { unconfirmedBytes: number };
    }>
  ).value;
  expect(restored.recovery.unconfirmedBytes).toBe(4);
  expect((await fs.stat(checkpoint.stagePath)).size).toBe(CHUNK_BYTES + 4);
  await sink.resume("new", restored.id);
  expect((await fs.stat(checkpoint.stagePath)).size).toBe(CHUNK_BYTES);
});
it("refuses substituted local targets, hard links and changed confirmed bytes", async () => {
  const f = await fixture(),
    checkpoint = await f.checkpoint(),
    sink = new DownloadSink(),
    options = { overwrite: false, source: spec(f.bytes), authorize: () => {} };
  closes.push(() => sink.reset("new"));
  await fs.writeFile(f.target, "external");
  await expect(sink.restore("new", checkpoint, options)).rejects.toThrow(
    "DOWNLOAD_TARGET_CHANGED",
  );
  expect(await fs.readFile(f.target, "utf8")).toBe("external");
  await fs.unlink(f.target);
  const link = path.join(f.root, "alias");
  await fs.link(checkpoint.stagePath, link);
  await expect(sink.restore("new", checkpoint, options)).rejects.toThrow(
    "DOWNLOAD_CHECKPOINT_CHANGED",
  );
  await fs.unlink(link);
  const handle = await fs.open(checkpoint.stagePath, "r+");
  await handle.write(Buffer.from([0]), 0, 1, 0);
  await handle.close();
  await expect(sink.restore("new", checkpoint, options)).rejects.toThrow(
    "DOWNLOAD_CHECKPOINT_CHANGED",
  );
  expect((await fs.stat(checkpoint.stagePath)).size).toBe(CHUNK_BYTES);
});
it("refuses unknown native commits instead of reclassifying them as suspended", async () => {
  const f = await fixture(Buffer.from("done"));
  await f.sink.resume("old", f.chosen.id);
  const copy = vi
    .spyOn(fs, "copyFile")
    .mockRejectedValueOnce(Object.assign(Error("failed"), { code: "EIO" }));
  try {
    await expect(f.sink.finish("old", f.chosen.id)).rejects.toThrow();
  } finally {
    copy.mockRestore();
  }
  const persist = vi.fn();
  await expect(f.sink.suspend("old", f.chosen.id, persist)).rejects.toThrow(
    "DOWNLOAD_NOT_READY",
  );
  expect(persist).not.toHaveBeenCalled();
  expect(f.sink.owned("old", f.chosen.id).view.state).toBe("unknown");
});

it("keeps a durable checkpoint protected if closing the original handle fails", async () => {
  const f = await fixture(Buffer.from("small")),
    record = f.sink.owned("old", f.chosen.id),
    close = vi
      .spyOn(record.handle, "close")
      .mockRejectedValueOnce(
        Object.assign(Error("close failed"), { code: "EIO" }),
      );
  let checkpoint: { stagePath: string } | undefined;
  try {
    await expect(
      f.sink.suspend("old", f.chosen.id, async (c: { stagePath: string }) => {
        checkpoint = c;
      }),
    ).rejects.toThrow("DOWNLOAD_LOCAL_IO_FAILED");
    await expect(f.sink.resume("old", f.chosen.id)).rejects.toThrow(
      "DOWNLOAD_CHECKPOINT_IN_USE",
    );
  } finally {
    close.mockRestore();
  }
  await f.sink.reset("old");
  expect(await fs.readFile(checkpoint!.stagePath, "utf8")).toBe("small");
});

it("requires fresh overwrite consent for an unchanged existing destination", async () => {
  const f = await fixture(Buffer.from("new value"));
  await f.sink.reset("old");
  await fs.writeFile(f.target, "old value");
  const chosen = await f.sink.choose(
    "old",
    spec(f.bytes),
    async () => f.target,
  );
  await f.sink.start("old", chosen.id, true);
  await f.sink.append("old", chosen.id, 0, f.bytes);
  await f.sink.pause("old", chosen.id);
  let checkpoint: unknown;
  await f.sink.suspend("old", chosen.id, async (c: unknown) => {
    checkpoint = c;
  });
  const next = new DownloadSink();
  closes.push(() => next.reset("new"));
  const options = {
    source: spec(f.bytes),
    authorize: () => {},
    overwrite: false,
  };
  await expect(next.restore("new", checkpoint, options)).rejects.toThrow(
    "DOWNLOAD_OVERWRITE_REQUIRED",
  );
  expect(await fs.readFile(f.target, "utf8")).toBe("old value");
  const restored = await next.restore("new", checkpoint, {
    ...options,
    overwrite: true,
  });
  await next.resume("new", restored.id);
  await next.finish("new", restored.id);
  expect(await fs.readFile(f.target, "utf8")).toBe("new value");
});
