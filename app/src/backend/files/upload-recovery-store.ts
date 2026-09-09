import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { openRecord, sealRecord } from "../privacy/encrypted-record-codec.js";
import { SystemRecordKey } from "../privacy/system-record-key.js";
import {
  uploadCheckpointSchema,
  type UploadCheckpoint,
} from "./upload-checkpoint.js";
const uuid = z.string().uuid(),
  maximum = 4 * 1024 * 1024;
const schema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    userId: z.string().min(1).max(256),
    checkpoint: uploadCheckpointSchema,
    state: z.enum([
      "available",
      "claimed",
      "committing",
      "unknown",
      "completed",
      "cancelled",
    ]),
    updatedAt: z.number().int().nonnegative(),
    claim: z
      .object({ id: uuid, boot: uuid, pid: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (row) =>
      !["claimed", "committing", "unknown"].includes(row.state) || !!row.claim,
  );
export type UploadRecoveryRecord = z.infer<typeof schema>;
export interface RecoveryKeyPort {
  load(userId: string, create: boolean): Promise<Buffer | null>;
}
export class UploadRecoveryStore {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private root: string;
  private boot = randomUUID();
  constructor(
    root: string,
    private keys: RecoveryKeyPort = new SystemRecordKey(
      root,
      "TandemSSH upload recovery",
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
    this.root = path.resolve(root, "tandem-upload-recovery");
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.pending >= 8) throw Error("UPLOAD_RECOVERY_BUSY");
    this.pending++;
    const p = this.tail.then(work);
    this.tail = p.catch(() => {});
    try {
      return await p;
    } finally {
      this.pending--;
    }
  }
  private async directory(user: string, create = false) {
    if (!user || user.length > 256) throw Error("UPLOAD_RECOVERY_INVALID");
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
        throw Error("UPLOAD_RECOVERY_PATH_INVALID");
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
      throw Error("UPLOAD_RECOVERY_ENCRYPTION_UNAVAILABLE");
    }
    if (!key || key.length !== 32) throw Error("UPLOAD_RECOVERY_KEY_MISSING");
    return key;
  }
  private async read(
    user: string,
    id: string,
  ): Promise<UploadRecoveryRecord | null> {
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
        throw Error("UPLOAD_RECOVERY_INVALID");
      handle = await fs.open(name, "r");
      const after = await handle.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.nlink !== 1 ||
        after.size > maximum
      )
        throw Error("UPLOAD_RECOVERY_INVALID");
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
        throw Error("UPLOAD_RECOVERY_INVALID");
      const key = await this.key(user, false);
      let row: UploadRecoveryRecord;
      try {
        row = schema.parse(
          JSON.parse(
            openRecord(bytes, key, "TUR1", JSON.stringify([user, id])),
          ),
        );
      } catch {
        throw Error("UPLOAD_RECOVERY_DECRYPT_FAILED");
      }
      if (
        row.userId !== user ||
        row.id !== id ||
        row.checkpoint.userId !== user ||
        row.checkpoint.id !== id
      )
        throw Error("UPLOAD_RECOVERY_INVALID");
      return row;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    } finally {
      await handle?.close();
    }
  }
  private async write(row: UploadRecoveryRecord) {
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
      throw Error("UPLOAD_RECOVERY_LIMIT");
    const bytes = sealRecord(
      text,
      key,
      "TUR1",
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
      throw Error("UPLOAD_RECOVERY_LIMIT");
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
  interrupted(row: UploadRecoveryRecord) {
    return (
      row.state === "claimed" &&
      row.claim?.boot !== this.boot &&
      !this.alive(row.claim!.pid)
    );
  }
  assertReconcile(row: UploadRecoveryRecord) {
    if (row.claim?.boot !== this.boot && row.claim && this.alive(row.claim.pid))
      throw Error("UPLOAD_RECOVERY_BUSY");
  }
  checked(user: string, id: string) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row || !["unknown", "committing"].includes(row.state))
        throw Error("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
      this.assertReconcile(row);
      row.state = "completed";
      row.updatedAt = Date.now();
      await this.write(row);
      return row;
    });
  }
  get(user: string, id: string) {
    return this.run(() => this.read(user, id));
  }
  list(user: string) {
    return this.run(async () => {
      const dir = await this.directory(user);
      if (!dir) return [];
      const rows: UploadRecoveryRecord[] = [];
      for (const file of (await fs.readdir(dir))
        .filter((f) => /^[a-f0-9-]{36}\.checkpoint$/.test(f))
        .slice(0, 128)) {
        const row = await this.read(user, file.slice(0, -11));
        if (row) rows.push(row);
      }
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }
  create(user: string, raw: unknown) {
    return this.run(async () => {
      const checkpoint = uploadCheckpointSchema.parse(raw);
      if (checkpoint.userId !== user) throw Error("UPLOAD_RECOVERY_NOT_FOUND");
      const old = await this.read(user, checkpoint.id);
      if (old) {
        if (JSON.stringify(old.checkpoint) !== JSON.stringify(checkpoint))
          throw Error("UPLOAD_RECOVERY_CONFLICT");
        return old;
      }
      const row: UploadRecoveryRecord = {
        schemaVersion: 1,
        userId: user,
        id: checkpoint.id,
        checkpoint,
        state: "available",
        updatedAt: Date.now(),
      };
      await this.write(row);
      return row;
    });
  }
  claim(user: string, id: string) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row) throw Error("UPLOAD_RECOVERY_NOT_FOUND");
      if (
        row.state === "claimed" &&
        (row.claim?.boot === this.boot || this.alive(row.claim!.pid))
      )
        throw Error("UPLOAD_RECOVERY_BUSY");
      if (!["available", "claimed"].includes(row.state))
        throw Error("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
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
    state: UploadRecoveryRecord["state"],
  ) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row || row.claim?.id !== claimId)
        throw Error("UPLOAD_RECOVERY_CONFLICT");
      const allowed: Record<string, string[]> = {
        claimed: ["available", "committing", "cancelled"],
        committing: ["completed", "unknown", "available", "claimed"],
        unknown: ["completed"],
        available: [],
        completed: [],
        cancelled: [],
      };
      if (!allowed[row.state].includes(state))
        throw Error("UPLOAD_RECOVERY_CONFLICT");
      row.state = state;
      row.updatedAt = Date.now();
      if (state === "available") delete row.claim;
      await this.write(row);
      return row;
    });
  }
  update(user: string, id: string, claimId: string, raw: UploadCheckpoint) {
    return this.run(async () => {
      const row = await this.read(user, id),
        next = uploadCheckpointSchema.parse(raw);
      if (
        !row ||
        !["claimed", "committing"].includes(row.state) ||
        row.claim?.id !== claimId ||
        next.userId !== user ||
        next.temporaryPath !== row.checkpoint.temporaryPath ||
        next.targetKey !== row.checkpoint.targetKey ||
        next.acceptedHostKey !== row.checkpoint.acceptedHostKey ||
        next.path !== row.checkpoint.path ||
        next.canonicalPath !== row.checkpoint.canonicalPath ||
        JSON.stringify(next.manifest) !==
          JSON.stringify(row.checkpoint.manifest) ||
        JSON.stringify(next.baseline) !==
          JSON.stringify(row.checkpoint.baseline)
      )
        throw Error("UPLOAD_RECOVERY_CONFLICT");
      row.checkpoint = { ...next, id };
      row.state = "available";
      delete row.claim;
      row.updatedAt = Date.now();
      await this.write(row);
      return row;
    });
  }
  remove(user: string, id: string) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (row && !["completed", "cancelled"].includes(row.state))
        throw Error("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
      const dir = await this.directory(user);
      if (dir)
        await fs.unlink(path.join(dir, id + ".checkpoint")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    });
  }
}
