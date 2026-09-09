import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  openRecord,
  sealRecord,
} from "../../privacy/encrypted-record-codec.js";
import { SystemRecordKey } from "../../privacy/system-record-key.js";
import {
  recordSchema as schema,
  readCheckpoint,
  type TaskRecoveryRecord,
} from "./schema.js";
import type { TaskExecutionCheckpoint } from "../../../types/task-recovery.js";
const uuid = z.string().uuid(),
  maximum = 16 * 1024 * 1024;
export interface TaskRecoveryKeyPort {
  load(userId: string, create: boolean): Promise<Buffer | null>;
}
export class TaskRecoveryStore {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private root: string;
  private boot = randomUUID();
  constructor(
    root: string,
    private keys: TaskRecoveryKeyPort = new SystemRecordKey(
      root,
      "TandemSSH task recovery",
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
    this.root = path.resolve(root, "tandem-task-recovery");
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.pending >= 8) throw Error("TASK_RECOVERY_BUSY");
    this.pending++;
    const p = this.tail.then(work);
    this.tail = p.catch(() => {});
    try {
      return await p;
    } finally {
      this.pending--;
    }
  }
  private async locked<T>(user: string, work: () => Promise<T>) {
    return this.run(async () => {
      const dir = await this.directory(user, true),
        lock = path.join(dir!, ".writer"),
        owner = process.pid + "-" + randomUUID() + ".owner";
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await fs.mkdir(lock);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          const stat = await fs.lstat(lock);
          if (!stat.isDirectory() || stat.isSymbolicLink())
            throw Error("TASK_RECOVERY_PATH_INVALID");
          const names = await fs.readdir(lock);
          if (!names.length && Date.now() - stat.mtimeMs < 30000)
            throw Error("TASK_RECOVERY_BUSY");
          for (const name of names) {
            const match = /^([1-9][0-9]*)-[a-f0-9-]{36}\.owner$/.exec(name);
            if (!match || this.alive(Number(match[1])))
              throw Error("TASK_RECOVERY_BUSY");
            await fs.unlink(path.join(lock, name)).catch((e) => {
              if (e.code !== "ENOENT") throw e;
            });
          }
          await fs.rmdir(lock).catch((e) => {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
          });
          continue;
        }
        const file = path.join(lock, owner);
        const handle = await fs.open(file, "wx", 0o600);
        await handle.close();
        try {
          return await work();
        } finally {
          await fs.unlink(file).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
          await fs.rmdir(lock).catch((e) => {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
          });
        }
      }
      throw Error("TASK_RECOVERY_BUSY");
    });
  }
  private async directory(user: string, create = false) {
    if (!user || user.length > 256) throw Error("TASK_RECOVERY_INVALID");
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
        throw Error("TASK_RECOVERY_PATH_INVALID");
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
      throw Error("TASK_RECOVERY_ENCRYPTION_UNAVAILABLE");
    }
    if (!key || key.length !== 32) throw Error("TASK_RECOVERY_KEY_MISSING");
    return key;
  }
  private async read(
    user: string,
    id: string,
  ): Promise<TaskRecoveryRecord | null> {
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
        throw Error("TASK_RECOVERY_INVALID");
      handle = await fs.open(name, "r");
      const after = await handle.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.nlink !== 1 ||
        after.size > maximum
      )
        throw Error("TASK_RECOVERY_INVALID");
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
        throw Error("TASK_RECOVERY_INVALID");
      const key = await this.key(user, false);
      let row: TaskRecoveryRecord;
      try {
        row = schema.parse(
          JSON.parse(
            openRecord(bytes, key, "TTR1", JSON.stringify([user, id])),
          ),
        );
      } catch {
        throw Error("TASK_RECOVERY_DECRYPT_FAILED");
      }
      if (
        row.userId !== user ||
        row.id !== id ||
        row.checkpoint.userId !== user ||
        row.checkpoint.id !== id
      )
        throw Error("TASK_RECOVERY_INVALID");
      return row;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    } finally {
      await handle?.close();
    }
  }
  private async write(row: TaskRecoveryRecord) {
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
      throw Error("TASK_RECOVERY_LIMIT");
    const bytes = sealRecord(
      text,
      key,
      "TTR1",
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
      (!previous && files.length >= 128) ||
      total - previous + bytes.length > 64 * 1024 * 1024
    )
      throw Error("TASK_RECOVERY_LIMIT");
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

  get(user: string, id: string) {
    return this.run(() => this.read(user, id));
  }
  async list(user: string) {
    return this.run(async () => {
      const dir = await this.directory(user);
      if (!dir) return [];
      const rows: TaskRecoveryRecord[] = [];
      for (const f of (await fs.readdir(dir))
        .filter((f) => /^[a-f0-9-]{36}\.checkpoint$/.test(f))
        .slice(0, 128)) {
        const row = await this.read(user, f.slice(0, -11));
        if (row) rows.push(row);
      }
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }
  interrupted(row: TaskRecoveryRecord) {
    return (
      ["live", "claimed"].includes(row.state) &&
      row.claim?.boot !== this.boot &&
      !this.alive(row.claim!.pid)
    );
  }
  save(user: string, raw: TaskExecutionCheckpoint, live = false) {
    return this.locked(user, async () => {
      const checkpoint = readCheckpoint(raw);
      if (checkpoint.userId !== user) throw Error("TASK_RECOVERY_NOT_FOUND");
      const old = await this.read(user, checkpoint.id);
      if (
        old &&
        (["claimed", "consumed"].includes(old.state) ||
          (old.state === "live" && old.claim?.boot !== this.boot))
      )
        throw Error("TASK_RECOVERY_BUSY");
      if (
        old &&
        JSON.stringify(old.checkpoint.host) !== JSON.stringify(checkpoint.host)
      )
        throw Error("TASK_RECOVERY_HOST_CHANGED");
      const row: TaskRecoveryRecord = {
        schemaVersion: 1,
        id: checkpoint.id,
        userId: user,
        checkpoint,
        state: live ? "live" : "available",
        updatedAt: Date.now(),
        claim: live
          ? {
              id: old?.claim?.id ?? randomUUID(),
              boot: this.boot,
              pid: process.pid,
            }
          : undefined,
      };
      await this.write(row);
      return row;
    });
  }
  claim(user: string, id: string) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (!row) throw Error("TASK_RECOVERY_NOT_FOUND");
      if (row.state !== "available" && !this.interrupted(row))
        throw Error("TASK_RECOVERY_BUSY");
      row.state = "claimed";
      row.claim = { id: randomUUID(), boot: this.boot, pid: process.pid };
      row.updatedAt = Date.now();
      await this.write(row);
      return row;
    });
  }
  transition(
    user: string,
    id: string,
    claimId: string,
    state: "available" | "consumed",
  ) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (!row || row.state !== "claimed" || row.claim?.id !== claimId)
        throw Error("TASK_RECOVERY_CONFLICT");
      row.state = state;
      delete row.claim;
      row.updatedAt = Date.now();
      await this.write(row);
      return row;
    });
  }
  remove(user: string, id: string) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (
        row &&
        !["available", "consumed"].includes(row.state) &&
        !this.interrupted(row)
      )
        throw Error("TASK_RECOVERY_BUSY");
      const dir = await this.directory(user);
      if (dir)
        await fs.unlink(path.join(dir, id + ".checkpoint")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    });
  }
}
