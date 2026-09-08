import { createHash } from "node:crypto";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
} from "../../types/file-upload.js";
import type { SFTPWrapper, Stats, FileEntry, Attributes } from "ssh2";
import { DocumentError } from "./errors.js";
import type {
  RemoteFileIO,
  RemoteFileStat,
  RemoteFileSnapshot,
} from "./ports.js";
function mapped(error: unknown): DocumentError {
  const e = error as { code?: number; message?: string };
  if (e?.code === 2) return new DocumentError("FILE_NOT_FOUND");
  if (e?.code === 3) return new DocumentError("FILE_PERMISSION_DENIED");
  if (e?.code === 8 || /does not support|not supported/i.test(e?.message ?? ""))
    return new DocumentError("FILE_ATOMIC_REPLACE_UNSUPPORTED", {
      commitMayHaveOccurred: false,
    });
  return new DocumentError("FILE_IO_FAILED");
}
function stat(value: Attributes): RemoteFileStat {
  return {
    size: value.size,
    mtime: value.mtime,
    atime: value.atime,
    mode: value.mode,
    uid: value.uid,
    gid: value.gid,
    kind:
      (value.mode & 0o170000) === 0o100000
        ? "file"
        : (value.mode & 0o170000) === 0o40000
          ? "directory"
          : (value.mode & 0o170000) === 0o120000
            ? "symlink"
            : "other",
  };
}
const same = (a: RemoteFileStat, b: RemoteFileStat) =>
  a.size === b.size &&
  a.mtime === b.mtime &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid;
export class SftpFileIO implements RemoteFileIO {
  constructor(
    private readonly sftp: SFTPWrapper,
    private readonly timeoutMs = 30000,
    private readonly maximumSnapshotBytes = 32 * 1024 * 1024,
  ) {}
  private call<T>(
    work: (done: (error: unknown, value: T) => void) => void,
    late?: (value: T) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new DocumentError("FILE_IO_TIMEOUT"));
        }
      }, this.timeoutMs);
      const done = (error: unknown, value: T) => {
        if (settled) {
          if (!error) late?.(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) reject(mapped(error));
        else resolve(value);
      };
      try {
        work(done);
      } catch (error) {
        done(error, undefined as T);
      }
    });
  }
  async resolve(path: string) {
    return this.call<string>((done) =>
      this.sftp.realpath(path, (e, value) => done(e, value)),
    );
  }
  async stat(path: string) {
    return stat(
      await this.call<Stats>((done) =>
        this.sftp.lstat(path, (e, value) => done(e, value)),
      ),
    );
  }
  async list(path: string, maximumEntries: number, guard: () => void) {
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.opendir(path, (e, h) => done(e, h)),
      this.lateClose,
    );
    const result: Array<{ name: string; stat: RemoteFileStat }> = [];
    let failure: unknown;
    try {
      let bytes = 0,
        emptyBatches = 0;
      for (;;) {
        guard();
        const entries = await this.call<FileEntry[] | false>((done) =>
          this.sftp.readdir(handle, (e, items) =>
            (e as { code?: number })?.code === 1
              ? done(undefined, false)
              : done(e, items),
          ),
        );
        if (entries === false) break;
        if (!Array.isArray(entries))
          throw new DocumentError("FILE_IO_INVALID_RESPONSE");
        if (!entries.length) {
          if (++emptyBatches > 64)
            throw new DocumentError("FILE_IO_INVALID_RESPONSE");
          continue;
        }
        emptyBatches = 0;
        for (const entry of entries) {
          if (entry.filename === "." || entry.filename === "..") continue;
          if (typeof entry.filename !== "string")
            throw new DocumentError("FILE_IO_INVALID_RESPONSE");
          bytes += Buffer.byteLength(entry.filename, "utf8") + 128;
          if (result.length >= maximumEntries || bytes > 2 * 1024 * 1024)
            throw new DocumentError("FILE_DIRECTORY_TOO_LARGE");
          result.push({ name: entry.filename, stat: stat(entry.attrs) });
        }
      }
      guard();
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return result;
  }
  async inspectFile(path: string, guard: () => void, limit?: number) {
    guard();
    const meta = await this.stat(path);
    if (meta.kind !== "file") throw new DocumentError("FILE_NOT_REGULAR");
    if (
      !Number.isSafeInteger(meta.size) ||
      meta.size < 0 ||
      meta.size > UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS
    )
      throw new DocumentError("FILE_TOO_LARGE");
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 0 || limit > meta.size)
    )
      throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "r", (e, h) => done(e, h)),
      this.lateClose,
    );
    const hashes: string[] = [],
      whole = createHash("sha256");
    let failure: unknown,
      offset = 0,
      result: RemoteFileStat | undefined;
    try {
      const before = await this.fstat(handle);
      if (before.kind !== "file" || !same(meta, before))
        throw new DocumentError("FILE_CHANGED_DURING_READ");
      const expected = limit ?? before.size;
      while (offset < expected) {
        const bytes = Buffer.alloc(
          Math.min(UPLOAD_CHUNK_BYTES, expected - offset),
        );
        let filled = 0;
        while (filled < bytes.length) {
          guard();
          const length = await this.call<number>((done) =>
            this.sftp.read(
              handle,
              bytes,
              filled,
              Math.min(32768, bytes.length - filled),
              offset + filled,
              (e, n) => done(e, n),
            ),
          );
          if (
            !Number.isInteger(length) ||
            length <= 0 ||
            length > Math.min(32768, bytes.length - filled)
          )
            throw new DocumentError("FILE_CHANGED_DURING_READ");
          filled += length;
        }
        whole.update(bytes);
        hashes.push(createHash("sha256").update(bytes).digest("hex"));
        offset += filled;
      }
      guard();
      result = await this.fstat(handle);
      if (!same(before, result))
        throw new DocumentError("FILE_CHANGED_DURING_READ");
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return {
      stat: result!,
      sha256: whole.digest("hex"),
      hashes,
      bytes: offset,
    };
  }
  async readAt(
    path: string,
    offset: number,
    length: number,
    guard: () => void,
  ) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > UPLOAD_CHUNK_BYTES
    )
      throw new DocumentError("DOWNLOAD_CHUNK_INVALID");
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "r", (e, h) => done(e, h)),
      this.lateClose,
    );
    let failure: unknown,
      result: { bytes: Buffer; stat: RemoteFileStat } | undefined;
    try {
      const before = await this.fstat(handle);
      if (before.kind !== "file" || offset + length > before.size)
        throw new DocumentError("DOWNLOAD_SOURCE_CHANGED");
      const bytes = Buffer.alloc(length);
      for (let n = 0; n < length;) {
        guard();
        const wanted = Math.min(32768, length - n);
        const count = await this.call<number>((done) =>
          this.sftp.read(handle, bytes, n, wanted, offset + n, (e, count) =>
            done(e, count),
          ),
        );
        if (!Number.isInteger(count) || count <= 0 || count > wanted)
          throw new DocumentError("DOWNLOAD_SOURCE_CHANGED");
        n += count;
      }
      guard();
      const after = await this.fstat(handle);
      if (!same(before, after))
        throw new DocumentError("DOWNLOAD_SOURCE_CHANGED");
      result = { bytes, stat: after };
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return result!;
  }
  async writeAt(
    path: string,
    offset: number,
    bytes: Buffer,
    guard: () => void,
  ) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      bytes.length > UPLOAD_CHUNK_BYTES
    )
      throw new DocumentError("UPLOAD_CHUNK_INVALID");
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "r+", (e, h) => done(e, h)),
      this.lateClose,
    );
    let failure: unknown;
    try {
      guard();
      const before = await this.fstat(handle);
      if (before.kind !== "file" || before.size !== offset)
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      for (let at = 0; at < bytes.length; at += 16384) {
        guard();
        await this.call<void>((done) =>
          this.sftp.write(
            handle,
            bytes,
            at,
            Math.min(16384, bytes.length - at),
            offset + at,
            (e) => done(e, undefined),
          ),
        );
      }
      guard();
      const after = await this.fstat(handle);
      if (after.size !== offset + bytes.length)
        throw new DocumentError("UPLOAD_CHUNK_INCOMPLETE");
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  async truncate(path: string, size: number, guard: () => void) {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new DocumentError("UPLOAD_CHUNK_INVALID");
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "r+", (e, h) => done(e, h)),
      this.lateClose,
    );
    let failure: unknown;
    try {
      guard();
      const before = await this.fstat(handle);
      if (before.kind !== "file" || before.size < size)
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
      guard();
      await this.call<void>((done) =>
        this.sftp.fsetstat(handle, { size }, (e) => done(e, undefined)),
      );
      guard();
      if ((await this.fstat(handle)).size !== size)
        throw new DocumentError("UPLOAD_CHECKPOINT_CHANGED");
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  async remove(path: string, guard: () => void) {
    guard();
    await this.call<void>((done) =>
      this.sftp.unlink(path, (e) => done(e, undefined)),
    );
  }
  private async fstat(handle: Buffer) {
    return stat(
      await this.call<Stats>((done) =>
        this.sftp.fstat(handle, (e, value) => done(e, value)),
      ),
    );
  }
  private async close(handle: Buffer) {
    await this.call<void>((done) =>
      this.sftp.close(handle, (e) => done(e, undefined)),
    );
  }
  private lateClose = (handle: Buffer) => {
    try {
      this.sftp.close(handle, () => {});
    } catch {
      /* The disconnected server owns final handle cleanup. */
    }
  };
  async snapshot(
    path: string,
    maximumBytes: number,
    guard: () => void = () => {},
  ): Promise<RemoteFileSnapshot> {
    guard();
    maximumBytes = Math.min(maximumBytes, this.maximumSnapshotBytes);
    const meta = await this.stat(path);
    if (meta.kind !== "file") throw new DocumentError("FILE_NOT_REGULAR");
    if (meta.size > maximumBytes) throw new DocumentError("FILE_TOO_LARGE");
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "r", (e, value) => done(e, value)),
      this.lateClose,
    );
    let failure: unknown;
    let result: RemoteFileSnapshot | undefined;
    try {
      const before = await this.fstat(handle);
      if (before.kind !== "file" || before.size > maximumBytes)
        throw new DocumentError("FILE_TOO_LARGE");
      const chunks: Buffer[] = [];
      let offset = 0;
      for (;;) {
        guard();
        const buffer = Buffer.alloc(Math.min(32768, maximumBytes - offset + 1));
        const count = await this.call<number>((done) =>
          this.sftp.read(
            handle,
            buffer,
            0,
            buffer.length,
            offset,
            (e, length) => done(e, length),
          ),
        );
        if (!Number.isInteger(count) || count < 0 || count > buffer.length)
          throw new DocumentError("FILE_IO_INVALID_RESPONSE");
        if (!count) break;
        offset += count;
        if (offset > maximumBytes) throw new DocumentError("FILE_TOO_LARGE");
        chunks.push(buffer.subarray(0, count));
      }
      const after = await this.fstat(handle);
      if (!same(before, after) || offset !== after.size)
        throw new DocumentError("FILE_CHANGED_DURING_READ");
      result = { bytes: Buffer.concat(chunks, offset), stat: after };
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return result!;
  }
  async createExclusive(
    path: string,
    bytes: Buffer,
    metadata: RemoteFileStat | undefined,
    guard: () => void,
  ): Promise<void> {
    guard();
    const handle = await this.call<Buffer>(
      (done) => this.sftp.open(path, "wx", 0o600, (e, value) => done(e, value)),
      this.lateClose,
    );
    let failure: unknown;
    try {
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        guard();
        const length = Math.min(16384, bytes.length - offset);
        await this.call<void>((done) =>
          this.sftp.write(handle, bytes, offset, length, offset, (e) =>
            done(e, undefined),
          ),
        );
      }
      const current = await this.fstat(handle);
      if (current.size !== bytes.length)
        throw new DocumentError("FILE_STAGE_VERIFICATION_FAILED");
      if (metadata) {
        const attrs: { mode?: number; uid?: number; gid?: number } = {};
        if ((current.mode & 0o7777) !== (metadata.mode & 0o7777))
          attrs.mode = metadata.mode & 0o7777;
        if (current.uid !== metadata.uid) attrs.uid = metadata.uid;
        if (current.gid !== metadata.gid) attrs.gid = metadata.gid;
        if (Object.keys(attrs).length) {
          guard();
          await this.call<void>((done) =>
            this.sftp.fsetstat(handle, attrs, (e) => done(e, undefined)),
          );
        }
        const updated = await this.fstat(handle);
        if (
          (updated.mode & 0o7777) !== (metadata.mode & 0o7777) ||
          updated.uid !== metadata.uid ||
          updated.gid !== metadata.gid
        )
          throw new DocumentError("FILE_METADATA_NOT_PRESERVED");
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close(handle);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  async replace(
    from: string,
    to: string,
    allowOverwrite: boolean,
    guard: () => void,
  ): Promise<{ atomic: boolean }> {
    guard();
    await this.call<void>((done) => {
      const callback = (e: unknown) => done(e, undefined);
      if (allowOverwrite) this.sftp.ext_openssh_rename(from, to, callback);
      else this.sftp.rename(from, to, callback);
    });
    // Only the accepted POSIX rename extension establishes this contract.
    // Standard SFTP rename is used for no-overwrite creation without claiming atomicity.
    return { atomic: allowOverwrite };
  }
}
