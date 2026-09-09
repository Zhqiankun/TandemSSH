import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  sealRecord,
  openRecord,
} from "../../privacy/encrypted-record-codec.js";
import { z } from "zod";
import type { FileDraftSnapshot } from "../../../types/file-draft.js";
export interface DraftBinding {
  userId: string;
  targetKey: string;
  acceptedHostKey: string;
  hostIdentity: string;
  path: string;
  canonicalPath: string;
}
export interface DraftKeyPort {
  load(userId: string, create: boolean): Promise<Buffer | null>;
}
const MiB = 1024 * 1024,
  maxFile = 100 * MiB;
const generated = /^[a-f0-9]{64}\.draft$/;
const snapshotSchema = z
  .object({
    revision: z.string().uuid(),
    savedAt: z.number().int().nonnegative(),
    hostIdentity: z.string().min(1).max(4096),
    path: z.string().min(1).max(4096),
    canonicalPath: z.string().min(1).max(4096),
    original: z.string(),
    content: z.string(),
    format: z
      .object({
        charset: z.enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"]),
        bom: z.boolean(),
        lineEnding: z.enum(["lf", "crlf", "cr", "mixed", "none"]),
      })
      .strict(),
  })
  .strict();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export class FileDraftStore {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private root: string;
  constructor(
    root: string,
    private keys: DraftKeyPort,
  ) {
    this.root = path.resolve(root);
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= 8) throw Error("FILE_DRAFT_BUSY");
    this.pending++;
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    try {
      return await result;
    } finally {
      this.pending--;
    }
  }
  private identity(b: DraftBinding) {
    if (
      !b.userId ||
      !b.targetKey ||
      !b.acceptedHostKey ||
      !b.hostIdentity ||
      !b.path.startsWith("/") ||
      !b.canonicalPath.startsWith("/")
    )
      throw Error("FILE_DRAFT_IDENTITY_UNAVAILABLE");
    return sha(
      JSON.stringify([
        b.userId,
        b.targetKey,
        b.acceptedHostKey,
        b.path,
        b.canonicalPath,
      ]),
    );
  }
  private async directory(userId: string, create = false) {
    const directory = path.join(this.root, "tandem-drafts", sha(userId));
    if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const actual = await fs.realpath(directory),
        root = await fs.realpath(this.root);
      const normalize = (v: string) =>
        process.platform === "win32" ? v.toLowerCase() : v;
      if (
        normalize(path.relative(root, actual)) !==
        normalize(path.join("tandem-drafts", sha(userId)))
      )
        throw Error("FILE_DRAFT_PATH_INVALID");
      return directory;
    } catch (e) {
      if (!create && (e as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw e;
    }
  }
  private async bytes(file: string): Promise<Buffer | null> {
    try {
      const before = await fs.lstat(file);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > maxFile
      )
        throw Error("FILE_DRAFT_INVALID");
      const handle = await fs.open(file, "r");
      try {
        const after = await handle.stat();
        if (
          before.ino !== after.ino ||
          before.dev !== after.dev ||
          after.nlink !== 1 ||
          after.size > maxFile
        )
          throw Error("FILE_DRAFT_INVALID");
        const bytes = Buffer.alloc(after.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (offset !== bytes.length) throw Error("FILE_DRAFT_INVALID");
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  private decode(bytes: Buffer, key: Buffer, id: string): FileDraftSnapshot {
    try {
      return snapshotSchema.parse(
        JSON.parse(openRecord(bytes, key, "TDF1", "TandemSSH draft v1:" + id)),
      );
    } catch {
      throw Error("FILE_DRAFT_DECRYPT_FAILED");
    }
  }
  private async key(userId: string, create: boolean) {
    let key: Buffer | null;
    try {
      key = await this.keys.load(userId, create);
    } catch {
      throw Error("FILE_DRAFT_ENCRYPTION_UNAVAILABLE");
    }
    if (!key || key.length !== 32) throw Error("FILE_DRAFT_KEY_MISSING");
    return key;
  }
  async read(binding: DraftBinding): Promise<FileDraftSnapshot | null> {
    return this.serial(async () => {
      const id = this.identity(binding),
        directory = await this.directory(binding.userId);
      if (!directory) return null;
      const data = await this.bytes(path.join(directory, id + ".draft"));
      if (!data) return null;
      return this.decode(data, await this.key(binding.userId, false), id);
    });
  }
  async write(
    binding: DraftBinding,
    input: Pick<FileDraftSnapshot, "original" | "content" | "format">,
    expected: string | null,
  ): Promise<FileDraftSnapshot> {
    return this.serial(async () => {
      if (
        Buffer.byteLength(input.original) > 8 * MiB ||
        Buffer.byteLength(input.content) > 8 * MiB
      )
        throw Error("FILE_DRAFT_TOO_LARGE");
      const id = this.identity(binding),
        directory = await this.directory(binding.userId, true),
        file = path.join(directory!, id + ".draft");
      const previous = await this.bytes(file),
        allEntries = await fs.readdir(directory!),
        entries = allEntries.filter((f) => generated.test(f)),
        temporaryEntries = allEntries.filter((f) =>
          /^write-[a-f0-9-]{36}\.tmp$/.test(f),
        );
      // Existing encrypted data must never be hidden by creating a replacement key.
      const key = await this.key(
          binding.userId,
          entries.length === 0 && temporaryEntries.length === 0,
        ),
        old = previous ? this.decode(previous, key, id) : null;
      if ((old?.revision ?? null) !== expected)
        throw Error("FILE_DRAFT_CONFLICT");
      const next = snapshotSchema.parse({
        ...input,
        revision: randomUUID(),
        savedAt: Date.now(),
        hostIdentity: binding.hostIdentity,
        path: binding.path,
        canonicalPath: binding.canonicalPath,
      });
      const bytes = sealRecord(
        JSON.stringify(next),
        key,
        "TDF1",
        "TandemSSH draft v1:" + id,
      );
      let total = 0;
      for (const name of [...entries, ...temporaryEntries])
        total += (await fs.lstat(path.join(directory!, name))).size;
      if (
        bytes.length > maxFile ||
        (!previous && entries.length >= 64) ||
        total - (previous?.length ?? 0) + bytes.length > 128 * MiB
      )
        throw Error("FILE_DRAFT_LIMIT");
      const temporary = path.join(directory!, "write-" + randomUUID() + ".tmp");
      let created = false;
      try {
        const handle = await fs.open(temporary, "wx", 0o600);
        created = true;
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.directory(binding.userId);
        // Recheck destination identity and revision before replacing an existing snapshot.
        const current = await this.bytes(file);
        if (
          (current ? this.decode(current, key, id).revision : null) !== expected
        )
          throw Error("FILE_DRAFT_CONFLICT");
        await fs.rename(temporary, file);
        created = false;
        return next;
      } finally {
        if (created) await fs.unlink(temporary).catch(() => {});
      }
    });
  }
  async remove(binding: DraftBinding, expected: string): Promise<void> {
    await this.serial(async () => {
      const id = this.identity(binding),
        directory = await this.directory(binding.userId);
      if (!directory) return;
      const file = path.join(directory, id + ".draft"),
        bytes = await this.bytes(file);
      if (!bytes) return;
      if (
        this.decode(bytes, await this.key(binding.userId, false), id)
          .revision !== expected
      )
        throw Error("FILE_DRAFT_CONFLICT");
      await this.directory(binding.userId);
      await fs.unlink(file);
    });
  }
}
