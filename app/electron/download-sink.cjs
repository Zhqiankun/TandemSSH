const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const CHUNK_BYTES = 4 * 1024 * 1024,
  MAX_CHUNKS = 16384;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (s) => [s.dev, s.ino, s.birthtimeMs].join(":");
const metadata = (s) => [identity(s), s.size, s.mtimeMs, s.mode].join(":");
function errorCode(error) {
  if (error instanceof Error && /^DOWNLOAD_[A-Z_]+$/.test(error.message))
    return error.message;
  if (error?.code === "ENOSPC") return "DOWNLOAD_DISK_FULL";
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code))
    return "DOWNLOAD_LOCAL_PERMISSION";
  if (error?.code === "EEXIST") return "DOWNLOAD_TARGET_CHANGED";
  return "DOWNLOAD_LOCAL_IO_FAILED";
}
function validateSpec(input) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name ||
    input.name.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(input.name) ||
    [".", ".."].includes(input.name) ||
    !Number.isSafeInteger(input.size) ||
    input.size < 0 ||
    input.size > CHUNK_BYTES * MAX_CHUNKS ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    !Array.isArray(input.hashes) ||
    input.hashes.length !== Math.ceil(input.size / CHUNK_BYTES) ||
    input.hashes.some((h) => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h))
  )
    throw Error("DOWNLOAD_SPEC_INVALID");
  return {
    name: input.name,
    size: input.size,
    sha256: input.sha256,
    hashes: [...input.hashes],
  };
}
async function hashHandle(handle, guard = () => {}, limit) {
  const before = await handle.stat();
  if (!before.isFile() || before.size > CHUNK_BYTES * MAX_CHUNKS)
    throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
  const end = limit ?? before.size;
  if (end > before.size) throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
  const hash = createHash("sha256"),
    hashes = [],
    buffer = Buffer.alloc(CHUNK_BYTES);
  for (let at = 0; at < end;) {
    const length = Math.min(CHUNK_BYTES, end - at);
    let filled = 0;
    while (filled < length) {
      guard();
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        Math.min(65536, length - filled),
        at + filled,
      );
      if (!bytesRead) throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
      filled += bytesRead;
    }
    hash.update(buffer.subarray(0, length));
    hashes.push(digest(buffer.subarray(0, length)));
    at += length;
  }
  const after = await handle.stat();
  if (metadata(before) !== metadata(after))
    throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
  return { stat: after, sha256: hash.digest("hex"), hashes };
}
async function baseline(file, guard = () => {}) {
  let meta;
  try {
    meta = await fs.lstat(file);
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
  if (!meta.isFile() || meta.isSymbolicLink())
    throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
  const handle = await fs.open(file, "r");
  try {
    const value = await hashHandle(handle, guard);
    if (
      identity(meta) !== identity(value.stat) ||
      identity(await fs.lstat(file)) !== identity(meta)
    )
      throw Error("DOWNLOAD_TARGET_CHANGED");
    return value;
  } finally {
    await handle.close();
  }
}
class DownloadSink {
  constructor() {
    this.records = new Map();
    this.choosing = 0;
    this.choosingBytes = 0;
    this.locks = new Set();
  }
  view(r) {
    return structuredClone(r.view);
  }
  owned(owner, id) {
    const r = this.records.get(id);
    if (!r || r.owner !== owner) throw Error("DOWNLOAD_NOT_FOUND");
    return r;
  }
  guard(r) {
    if (r.cancelled) throw Error("DOWNLOAD_CANCELLED");
    r.touched = Date.now();
  }
  async choose(owner, raw, choosePath, expectedTarget) {
    const spec = validateSpec(raw);
    const bytes = spec.hashes.length * 64;
    if (
      this.records.size + this.choosing >= 128 ||
      bytes +
        this.choosingBytes +
        [...this.records.values()].reduce(
          (sum, r) => sum + r.spec.hashes.length * 64,
          0,
        ) >
        8 * 1024 * 1024
    )
      throw Error("DOWNLOAD_LIMIT");
    this.choosing++;
    this.choosingBytes += bytes;
    try {
      const chosen = await choosePath(spec.name);
      if (!chosen) return null;
      if (!path.isAbsolute(chosen)) throw Error("DOWNLOAD_LOCAL_FILE_INVALID");
      const name = path.basename(chosen);
      if (
        process.platform === "win32" &&
        (/[<>:"|?*\x00-\x1f]/.test(name) ||
          /[ .]$/.test(name) ||
          /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
      )
        throw Error("DOWNLOAD_LOCAL_NAME_INVALID");
      const parent = await fs.realpath(path.dirname(chosen)),
        parentIdentity = identity(await fs.stat(parent));
      if (expectedTarget?.parent) {
        const comparable = (p) =>
          process.platform === "win32" ? p.toLowerCase() : p;
        if (
          comparable(parent) !== comparable(expectedTarget.parent.path) ||
          parentIdentity !== expectedTarget.parent.identity
        )
          throw Error("DOWNLOAD_TARGET_CHANGED");
      }
      const destination = path.join(parent, name),
        previous = await baseline(destination);
      if (
        expectedTarget &&
        (Boolean(previous) !== Boolean(expectedTarget.value) ||
          (previous &&
            (previous.sha256 !== expectedTarget.value.sha256 ||
              metadata(previous.stat) !== metadata(expectedTarget.value.stat))))
      )
        throw Error("DOWNLOAD_TARGET_CHANGED");
      const r = {
        owner,
        spec,
        parent,
        parentIdentity,
        previous,
        cancelled: false,
        handle: undefined,
        stageIdentity: undefined,
        tail: Promise.resolve(),
        touched: Date.now(),
        view: {
          id: randomUUID(),
          path: destination,
          size: spec.size,
          writtenBytes: 0,
          state: "preview",
          existing: previous
            ? { size: previous.stat.size, modifiedAt: previous.stat.mtimeMs }
            : undefined,
        },
      };
      this.records.set(r.view.id, r);
      return this.view(r);
    } finally {
      this.choosing--;
      this.choosingBytes -= bytes;
    }
  }
  run(owner, id, work) {
    const r = this.owned(owner, id);
    if ((r.pending ?? 0) >= 2 || (this.pending ?? 0) >= 16)
      throw Error("DOWNLOAD_BUSY");
    r.pending = (r.pending ?? 0) + 1;
    this.pending = (this.pending ?? 0) + 1;
    const promise = r.tail.then(async () => {
      r.touched = Date.now();
      try {
        return await work(r);
      } catch (error) {
        const code = errorCode(error);
        r.view.error = code;
        if (!["unknown", "completed", "cancelled"].includes(r.view.state))
          r.view.state = "failed";
        throw Error(code);
      }
    });
    const settled = promise.finally(() => {
      r.pending--;
      this.pending--;
    });
    r.tail = settled.catch(() => {});
    return settled;
  }
  async parent(r) {
    this.guard(r);
    if (
      (await fs.realpath(r.parent)) !== r.parent ||
      identity(await fs.stat(r.parent)) !== r.parentIdentity
    )
      throw Error("DOWNLOAD_TARGET_CHANGED");
  }
  async stage(r) {
    await this.parent(r);
    if (!r.handle || !r.view.temporaryPath)
      throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
    const current = await fs.lstat(r.view.temporaryPath);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      identity(current) !== r.stageIdentity ||
      identity(await r.handle.stat()) !== r.stageIdentity
    )
      throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
  }
  async targetUnchanged(r) {
    await this.parent(r);
    const current = await baseline(r.view.path, () => this.guard(r));
    if (
      !!current !== !!r.previous ||
      (current &&
        (metadata(current.stat) !== metadata(r.previous.stat) ||
          current.sha256 !== r.previous.sha256))
    )
      throw Error("DOWNLOAD_TARGET_CHANGED");
  }
  start(owner, id, overwrite) {
    return this.run(owner, id, async (r) => {
      this.guard(r);
      if (r.view.state !== "preview") throw Error("DOWNLOAD_NOT_READY");
      if (typeof overwrite !== "boolean" || (r.previous && !overwrite))
        throw Error("DOWNLOAD_OVERWRITE_REQUIRED");
      await this.targetUnchanged(r);
      const stage = path.join(
        r.parent,
        ".tandem-download-" + randomUUID() + ".part",
      );
      const handle = await fs.open(stage, "wx+", 0o600);
      r.handle = handle;
      r.view.temporaryPath = stage;
      r.stageIdentity = identity(await handle.stat());
      r.overwrite = overwrite;
      r.view.state = "writing";
      r.view.error = undefined;
      this.guard(r);
      return this.view(r);
    });
  }
  append(owner, id, offset, input) {
    if (!(input instanceof Uint8Array) || input.byteLength > CHUNK_BYTES)
      throw Error("DOWNLOAD_CHUNK_INVALID");
    const bytes = Buffer.from(input);
    return this.run(owner, id, async (r) => {
      if (r.view.state !== "writing") throw Error("DOWNLOAD_NOT_READY");
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset % CHUNK_BYTES ||
        bytes.length !== Math.min(CHUNK_BYTES, r.spec.size - offset) ||
        !bytes.length ||
        digest(bytes) !== r.spec.hashes[offset / CHUNK_BYTES]
      )
        throw Error("DOWNLOAD_CHUNK_INVALID");
      await this.stage(r);
      if (
        offset < r.view.writtenBytes &&
        offset + bytes.length <= r.view.writtenBytes
      ) {
        const present = Buffer.alloc(bytes.length);
        let read = 0;
        while (read < present.length) {
          this.guard(r);
          const n = await r.handle.read(
            present,
            read,
            present.length - read,
            offset + read,
          );
          if (!n.bytesRead) throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
          read += n.bytesRead;
        }
        if (digest(present) !== digest(bytes))
          throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
        return this.view(r);
      }
      if (
        offset !== r.view.writtenBytes ||
        (await r.handle.stat()).size !== offset
      )
        throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
      for (let at = 0; at < bytes.length;) {
        this.guard(r);
        const { bytesWritten } = await r.handle.write(
          bytes,
          at,
          Math.min(65536, bytes.length - at),
          offset + at,
        );
        if (!bytesWritten) throw Error("DOWNLOAD_LOCAL_IO_FAILED");
        at += bytesWritten;
      }
      await r.handle.sync();
      this.guard(r);
      r.view.writtenBytes += bytes.length;
      return this.view(r);
    });
  }
  pause(owner, id) {
    return this.run(owner, id, async (r) => {
      if (!["writing", "paused", "failed"].includes(r.view.state))
        throw Error("DOWNLOAD_NOT_READY");
      await this.stage(r);
      await r.handle.sync();
      r.view.state = "paused";
      return this.view(r);
    });
  }
  resume(owner, id) {
    return this.run(owner, id, async (r) => {
      if (!["paused", "failed"].includes(r.view.state))
        throw Error("DOWNLOAD_NOT_READY");
      await this.stage(r);
      const current = await hashHandle(
        r.handle,
        () => this.guard(r),
        r.view.writtenBytes,
      );
      if (current.hashes.some((h, i) => h !== r.spec.hashes[i]))
        throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
      await r.handle.truncate(r.view.writtenBytes);
      await r.handle.sync();
      r.view.state = "writing";
      r.view.error = undefined;
      return this.view(r);
    });
  }
  finish(owner, id) {
    return this.run(owner, id, async (r) => {
      if (r.view.state === "completed") return this.view(r);
      if (r.view.state !== "writing" || r.view.writtenBytes !== r.spec.size)
        throw Error("DOWNLOAD_INCOMPLETE");
      await this.stage(r);
      const checked = await hashHandle(r.handle, () => this.guard(r));
      if (checked.sha256 !== r.spec.sha256 || checked.stat.size !== r.spec.size)
        throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
      const key =
        process.platform === "win32" ? r.view.path.toLowerCase() : r.view.path;
      if (this.locks.has(key)) throw Error("DOWNLOAD_TARGET_BUSY");
      this.locks.add(key);
      try {
        await this.targetUnchanged(r);
        await this.stage(r);
        await r.handle.sync();
        await r.handle.close();
        r.handle = undefined;
        this.guard(r);
        // The OS replacement has no atomic compare-and-swap with external writers.
        // Never remove the original destination before replacing it.
        try {
          if (r.previous) await fs.rename(r.view.temporaryPath, r.view.path);
          else
            await fs.copyFile(
              r.view.temporaryPath,
              r.view.path,
              constants.COPYFILE_EXCL,
            );
        } catch (error) {
          if (error.code !== "EEXIST") r.view.state = "unknown";
          throw error;
        }
        r.view.state = "unknown";
        const result = await baseline(r.view.path);
        if (
          !result ||
          result.stat.size !== r.spec.size ||
          result.sha256 !== r.spec.sha256
        )
          throw Error("DOWNLOAD_RESULT_UNVERIFIED");
        if (!r.previous) {
          const stage = await fs.lstat(r.view.temporaryPath);
          if (identity(stage) !== r.stageIdentity)
            throw Error("DOWNLOAD_CHECKPOINT_CHANGED");
          await fs.unlink(r.view.temporaryPath);
        }
        r.view.temporaryPath = undefined;
        r.view.state = "completed";
        r.view.sha256 = result.sha256;
        r.view.error = undefined;
        return this.view(r);
      } finally {
        this.locks.delete(key);
      }
    });
  }
  cancel(owner, id) {
    const record = this.owned(owner, id);
    record.cancelled = true;
    return this.run(owner, id, async (r) => {
      if (["completed", "unknown"].includes(r.view.state)) return this.view(r);
      if (r.handle) {
        await r.handle.close();
        r.handle = undefined;
      }
      if (r.view.temporaryPath) {
        const current = await fs.lstat(r.view.temporaryPath);
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          identity(current) !== r.stageIdentity ||
          (await fs.realpath(r.parent)) !== r.parent ||
          identity(await fs.stat(r.parent)) !== r.parentIdentity
        )
          throw Error("DOWNLOAD_CLEANUP_PENDING");
        await fs.unlink(r.view.temporaryPath);
        r.view.temporaryPath = undefined;
      }
      r.view.state = "cancelled";
      r.view.error = undefined;
      return this.view(r);
    });
  }
  forget(owner, id) {
    const r = this.owned(owner, id);
    if (r.pending) throw Error("DOWNLOAD_BUSY");
    if (
      !["completed", "cancelled"].includes(r.view.state) ||
      r.handle ||
      r.view.temporaryPath
    )
      throw Error("DOWNLOAD_NOT_READY");
    this.records.delete(id);
    return this.view(r);
  }
  async reset(owner) {
    const records = [...this.records.values()].filter((r) => r.owner === owner);
    for (const r of records) r.cancelled = true;
    await Promise.all(
      records.map(async (r) => {
        try {
          await this.cancel(owner, r.view.id);
        } catch {
          /* Keep unknown files for explicit recovery; never delete another file. */
        } finally {
          this.records.delete(r.view.id);
        }
      }),
    );
  }
  async prune() {
    const owners = new Set(
      [...this.records.values()]
        .filter((r) => Date.now() - r.touched > 30 * 60 * 1000)
        .map((r) => r.owner),
    );
    for (const owner of owners) {
      for (const r of [...this.records.values()].filter(
        (r) => r.owner === owner && Date.now() - r.touched > 30 * 60 * 1000,
      )) {
        try {
          await this.cancel(owner, r.view.id);
        } catch {}
        if (!r.view.temporaryPath) this.records.delete(r.view.id);
      }
    }
  }
}
module.exports = {
  DownloadSink,
  validateSpec,
  CHUNK_BYTES,
  MAX_CHUNKS,
  errorCode,
  inspectDownloadTarget: baseline,
};
