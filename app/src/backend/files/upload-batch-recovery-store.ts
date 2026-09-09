import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sealRecord, openRecord } from "../privacy/encrypted-record-codec.js";
import { SystemRecordKey } from "../privacy/system-record-key.js";
import {
  uploadBatchRecordSchema as schema,
  uploadBatchSnapshotSchema,
  type UploadBatchRecord,
  type UploadBatchSnapshot,
} from "./upload-batch-snapshot.js";
const uuid = z.string().uuid(),
  maximum = 32 * 1024 * 1024;
export interface UploadBatchKeyPort {
  load(user: string, create: boolean): Promise<Buffer | null>;
}
export class UploadBatchRecoveryStore {
  private root: string;
  private boot = randomUUID();
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    root: string,
    private keys: UploadBatchKeyPort = new SystemRecordKey(
      root,
      "TandemSSH upload batch recovery",
    ),
    private alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code !== "ESRCH";
      }
    },
  ) {
    this.root = path.resolve(root, "tandem-upload-batches");
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.pending >= 8) throw Error("UPLOAD_BATCH_BUSY");
    this.pending++;
    const p = this.tail.then(work);
    this.tail = p.catch(() => {});
    try {
      return await p;
    } finally {
      this.pending--;
    }
  }
  private async lease(user: string) {
    const dir = (await this.directory(user, true))!,
      lock = path.join(dir, ".writer"),
      owner = process.pid + "-" + randomUUID() + ".owner";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.mkdir(lock);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await fs.lstat(lock);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw Error("UPLOAD_BATCH_PATH_INVALID");
        const names = await fs.readdir(lock);
        for (const name of names) {
          const match = /^([1-9][0-9]*)-[a-f0-9-]{36}\.owner$/.exec(name);
          if (!match || this.alive(Number(match[1])))
            throw Error("UPLOAD_BATCH_BUSY");
          await fs.unlink(path.join(lock, name)).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
        }
        await fs.rmdir(lock).catch((e) => {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
        });
        continue;
      }
      const owned = path.join(lock, owner);
      let created = false;
      try {
        const handle = await fs.open(owned, "wx", 0o600);
        created = true;
        await handle.close();
        const names = await fs.readdir(lock);
        if (names.length !== 1 || names[0] !== owner)
          throw Error("UPLOAD_BATCH_BUSY");
        return async () => {
          await fs.unlink(owned).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
          await fs.rmdir(lock).catch((e) => {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
          });
        };
      } catch (error) {
        if (created) await fs.unlink(owned).catch(() => {});
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    throw Error("UPLOAD_BATCH_BUSY");
  }
  private locked<T>(user: string, work: () => Promise<T>) {
    return this.run(async () => {
      const release = await this.lease(user);
      try {
        return await work();
      } finally {
        await release();
      }
    });
  }
  private async directory(user: string, create = false) {
    if (!user || user.length > 256) throw Error("UPLOAD_BATCH_INVALID");
    const scope = createHash("sha256").update(user).digest("hex"),
      dir = path.join(this.root, scope);
    if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const actual = await fs.realpath(dir),
        root = await fs.realpath(this.root);
      if (
        (process.platform === "win32"
          ? path.relative(root, actual).toLowerCase()
          : path.relative(root, actual)) !== scope
      )
        throw Error("UPLOAD_BATCH_PATH_INVALID");
      return dir;
    } catch (e) {
      if (!create && (e as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw e;
    }
  }
  private async key(user: string, create: boolean) {
    let key: Buffer | null;
    try {
      key = await this.keys.load(user, create);
    } catch {
      throw Error("UPLOAD_BATCH_ENCRYPTION_UNAVAILABLE");
    }
    if (!key || key.length !== 32) throw Error("UPLOAD_BATCH_KEY_MISSING");
    return key;
  }
  private async read(
    user: string,
    id: string,
  ): Promise<UploadBatchRecord | null> {
    uuid.parse(id);
    const dir = await this.directory(user);
    if (!dir) return null;
    let handle;
    try {
      const name = path.join(dir, id + ".checkpoint"),
        before = await fs.lstat(name);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > maximum
      )
        throw Error("UPLOAD_BATCH_INVALID");
      handle = await fs.open(name, "r");
      const after = await handle.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.nlink !== 1 ||
        after.size > maximum
      )
        throw Error("UPLOAD_BATCH_INVALID");
      const bytes = Buffer.alloc(after.size);
      let offset = 0;
      while (offset < bytes.length) {
        const next = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!next.bytesRead) break;
        offset += next.bytesRead;
      }
      if (offset !== bytes.length || (await handle.stat()).size !== after.size)
        throw Error("UPLOAD_BATCH_INVALID");
      const key = await this.key(user, false);
      let row: UploadBatchRecord;
      try {
        row = schema.parse(
          JSON.parse(
            openRecord(bytes, key, "TUB1", JSON.stringify([user, id])),
          ),
        );
      } catch {
        throw Error("UPLOAD_BATCH_DECRYPT_FAILED");
      }
      if (
        row.userId !== user ||
        row.id !== id ||
        row.payload.tree.userId !== user
      )
        throw Error("UPLOAD_BATCH_INVALID");
      return row;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    } finally {
      await handle?.close();
    }
  }
  private async write(row: UploadBatchRecord) {
    schema.parse(row);
    const dir = await this.directory(row.userId, true),
      files = (await fs.readdir(dir!)).filter(
        (f) =>
          /^[a-f0-9-]{36}\.checkpoint$/.test(f) ||
          /^write-[a-f0-9-]{36}\.tmp$/.test(f),
      ),
      key = await this.key(row.userId, files.length === 0),
      text = JSON.stringify(row);
    if (Buffer.byteLength(text) > maximum - 32)
      throw Error("UPLOAD_BATCH_LIMIT");
    const bytes = sealRecord(
      text,
      key,
      "TUB1",
      JSON.stringify([row.userId, row.id]),
    );
    let total = 0,
      previous = 0;
    for (const name of files) {
      const size = (await fs.lstat(path.join(dir!, name))).size;
      total += size;
      if (name === row.id + ".checkpoint") previous = size;
    }
    if (
      (!previous && files.length >= 8) ||
      total - previous + bytes.length > 256 * 1024 * 1024
    )
      throw Error("UPLOAD_BATCH_LIMIT");
    const temp = path.join(dir!, "write-" + randomUUID() + ".tmp");
    let created = false;
    try {
      const handle = await fs.open(temp, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.directory(row.userId);
      await fs.rename(temp, path.join(dir!, row.id + ".checkpoint"));
      created = false;
    } finally {
      if (created) await fs.unlink(temp).catch(() => {});
    }
  }

  interrupted(row: UploadBatchRecord) {
    return (
      ["preparing", "claimed"].includes(row.state) &&
      row.claim?.boot !== this.boot &&
      !this.alive(row.claim!.pid)
    );
  }
  get(user: string, id: string) {
    return this.run(() => this.read(user, id));
  }
  list(user: string) {
    return this.run(async () => {
      const dir = await this.directory(user);
      if (!dir) return [];
      const rows: UploadBatchRecord[] = [];
      for (const name of (await fs.readdir(dir))
        .filter((n) => /^[a-f0-9-]{36}\.checkpoint$/.test(n))
        .slice(0, 8)) {
        const row = await this.read(user, name.slice(0, -11));
        if (row) rows.push(row);
      }
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }
  create(user: string, id: string, raw: unknown) {
    return this.locked(user, async () => {
      uuid.parse(id);
      const payload = uploadBatchSnapshotSchema.parse(raw);
      if (payload.tree.userId !== user) throw Error("UPLOAD_BATCH_NOT_FOUND");
      const old = await this.read(user, id);
      if (old) {
        if (JSON.stringify(old.payload) !== JSON.stringify(payload))
          throw Error("UPLOAD_BATCH_CONFLICT");
        return old;
      }
      const row: UploadBatchRecord = {
        schemaVersion: 1,
        id,
        userId: user,
        payload,
        state: "preparing",
        claim: { id: randomUUID(), boot: this.boot, pid: process.pid },
        updatedAt: Date.now(),
      };
      await this.write(row);
      return row;
    });
  }
  claim(user: string, id: string) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (!row) throw Error("UPLOAD_BATCH_NOT_FOUND");
      if (
        ["preparing", "claimed"].includes(row.state) &&
        (row.claim?.boot === this.boot || this.alive(row.claim!.pid))
      )
        throw Error("UPLOAD_BATCH_BUSY");
      if (!["available", "preparing", "claimed"].includes(row.state))
        throw Error("UPLOAD_BATCH_NOT_AVAILABLE");
      row.state = "claimed";
      row.claim = { id: randomUUID(), boot: this.boot, pid: process.pid };
      row.updatedAt = Date.now();
      await this.write(row);
      return row;
    });
  }
  change(
    user: string,
    id: string,
    claimId: string,
    update: (row: UploadBatchRecord) => void,
  ) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (
        !row ||
        row.claim?.id !== claimId ||
        !["preparing", "claimed"].includes(row.state)
      )
        throw Error("UPLOAD_BATCH_CONFLICT");
      const identity = (p: UploadBatchSnapshot) =>
        JSON.stringify([
          p.tree.targetKey,
          p.tree.peer,
          p.tree.path,
          p.tree.canonicalRoot,
          p.tree.lineageId ?? p.tree.id,
          p.source,
          p.tree.entries.map((e) => [
            e.view.id,
            e.view.parentId,
            e.view.name,
            e.view.kind,
            e.view.path,
            e.view.size,
            e.view.lastModified,
          ]),
        ]);
      const original = identity(row.payload);
      update(row);
      if (identity(row.payload) !== original)
        throw Error("UPLOAD_BATCH_CONFLICT");
      row.updatedAt = Date.now();
      schema.parse(row);
      await this.write(row);
      return row;
    });
  }
  release(user: string, id: string, claimId: string) {
    return this.change(user, id, claimId, (row) => {
      row.state = "available";
      delete row.claim;
    });
  }
  remove(user: string, id: string) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (row && !["completed", "cancelled"].includes(row.state))
        throw Error("UPLOAD_BATCH_NOT_AVAILABLE");
      const dir = await this.directory(user);
      if (dir)
        await fs.unlink(path.join(dir, id + ".checkpoint")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    });
  }
}
