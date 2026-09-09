const fs = require("node:fs/promises"),
  path = require("node:path"),
  { createHash, randomUUID } = require("node:crypto");
const { readDownloadCheckpoint } = require("./download-checkpoint.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  generated = /^[a-f0-9-]{36}\.recovery$/,
  maximum = 4 * 1024 * 1024;
class DownloadRecoveryVault {
  constructor({
    root,
    crypto,
    bootId = randomUUID(),
    pid = process.pid,
    isAlive,
  }) {
    this.root = path.resolve(root);
    this.crypto = crypto;
    this.bootId = bootId;
    this.pid = pid;
    this.isAlive =
      isAlive ||
      ((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return e.code !== "ESRCH";
        }
      });
    this.tail = Promise.resolve();
    this.pending = 0;
  }
  async run(work) {
    if (this.pending >= 8) throw Error("DOWNLOAD_RECOVERY_BUSY");
    this.pending++;
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    try {
      return await next;
    } finally {
      this.pending--;
    }
  }
  available() {
    if (
      !this.crypto.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        this.crypto.getSelectedStorageBackend?.() === "basic_text")
    )
      throw Error("DOWNLOAD_RECOVERY_ENCRYPTION_UNAVAILABLE");
  }
  async directory(user, create = false) {
    if (typeof user !== "string" || !user || user.length > 256)
      throw Error("DOWNLOAD_RECOVERY_INVALID");
    const scope = createHash("sha256").update(user).digest("hex"),
      dir = path.join(this.root, scope);
    if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const actual = await fs.realpath(dir),
        root = await fs.realpath(this.root),
        normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
      if (normalize(path.relative(root, actual)) !== scope)
        throw Error("DOWNLOAD_RECOVERY_PATH_INVALID");
      return dir;
    } catch (e) {
      if (!create && e.code === "ENOENT") return undefined;
      throw e;
    }
  }
  validate(row, user, id) {
    if (
      !row ||
      row.schemaVersion !== 1 ||
      row.userId !== user ||
      row.id !== id ||
      !uuid.test(id) ||
      !row.source ||
      row.source.userId !== user ||
      row.source.id !== id ||
      typeof row.hostLabel !== "string" ||
      !Number.isFinite(row.savedAt) ||
      ![
        "available",
        "claimed",
        "committing",
        "unknown",
        "completed",
        "cancelled",
      ].includes(row.state)
    )
      throw Error("DOWNLOAD_RECOVERY_CORRUPT");
    readDownloadCheckpoint(row.local);
    if (
      row.claim &&
      (!uuid.test(row.claim.id) ||
        typeof row.claim.boot !== "string" ||
        !Number.isSafeInteger(row.claim.pid) ||
        row.claim.pid <= 0)
    )
      throw Error("DOWNLOAD_RECOVERY_CORRUPT");
    return row;
  }
  async read(user, id) {
    if (!uuid.test(id)) throw Error("DOWNLOAD_RECOVERY_INVALID");
    const dir = await this.directory(user);
    if (!dir) return null;
    let handle;
    try {
      const file = path.join(dir, id + ".recovery"),
        before = await fs.lstat(file);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > maximum
      )
        throw Error("DOWNLOAD_RECOVERY_CORRUPT");
      handle = await fs.open(file, "r");
      const after = await handle.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.nlink !== 1 ||
        after.size > maximum
      )
        throw Error("DOWNLOAD_RECOVERY_CORRUPT");
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
        throw Error("DOWNLOAD_RECOVERY_CORRUPT");
      this.available();
      let row;
      try {
        row = JSON.parse(this.crypto.decryptString(bytes));
      } catch {
        throw Error("DOWNLOAD_RECOVERY_DECRYPT_FAILED");
      }
      return this.validate(row, user, id);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    } finally {
      await handle?.close();
    }
  }
  async write(row) {
    this.available();
    this.validate(row, row.userId, row.id);
    const text = JSON.stringify(row);
    if (Buffer.byteLength(text) > maximum - 4096)
      throw Error("DOWNLOAD_RECOVERY_LIMIT");
    const bytes = this.crypto.encryptString(text),
      dir = await this.directory(row.userId, true),
      files = (await fs.readdir(dir)).filter(
        (f) => generated.test(f) || /^write-[a-f0-9-]{36}\.tmp$/.test(f),
      );
    let total = 0,
      previous = 0;
    for (const name of files) {
      const stat = await fs.lstat(path.join(dir, name));
      total += stat.size;
      if (name === row.id + ".recovery") previous = stat.size;
    }
    if (
      (!previous && files.length >= 128) ||
      total - previous + bytes.length > 64 * 1024 * 1024
    )
      throw Error("DOWNLOAD_RECOVERY_LIMIT");
    const temporary = path.join(dir, "write-" + randomUUID() + ".tmp");
    let made = false;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      made = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.directory(row.userId);
      await fs.rename(temporary, path.join(dir, row.id + ".recovery"));
      made = false;
    } finally {
      if (made) await fs.unlink(temporary).catch(() => {});
    }
  }
  summary(row) {
    const interrupted =
      row.state === "claimed" &&
      row.claim?.boot !== this.bootId &&
      !this.isAlive(row.claim.pid);
    return {
      id: row.id,
      hostLabel: row.hostLabel,
      path: row.source.path,
      localPath: row.local.destination,
      size: row.local.spec.size,
      writtenBytes:
        row.state === "completed"
          ? row.local.spec.size
          : row.state === "cancelled"
            ? 0
            : row.local.writtenBytes,
      savedAt: row.savedAt,
      state: interrupted ? "interrupted" : row.state,
      existing: !!row.local.previous,
    };
  }
  list(user) {
    return this.run(async () => {
      const dir = await this.directory(user);
      if (!dir) return [];
      const result = [];
      for (const name of (await fs.readdir(dir))
        .filter((f) => generated.test(f))
        .slice(0, 128)) {
        const id = name.slice(0, -9);
        try {
          const row = await this.read(user, id);
          if (row) result.push(this.summary(row));
        } catch (e) {
          result.push({ id, state: "unreadable", error: e.message });
        }
      }
      return result.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    });
  }
  create(user, source, local, hostLabel) {
    return this.run(async () => {
      const old = await this.read(user, source.id);
      if (old) {
        if (old.local.id !== local.id)
          throw Error("DOWNLOAD_RECOVERY_CONFLICT");
        return old;
      }
      const row = {
        schemaVersion: 1,
        id: source.id,
        userId: user,
        source,
        local: readDownloadCheckpoint(local),
        hostLabel: hostLabel || "SSH",
        savedAt: Date.now(),
        state: "available",
      };
      await this.write(row);
      return row;
    });
  }
  refresh(user, id, claimId, source, local) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (
        !row ||
        row.state !== "claimed" ||
        row.claim?.id !== claimId ||
        ["userId", "targetKey", "peer", "path", "canonicalPath", "sha256"].some(
          (key) => source[key] !== row.source[key],
        )
      )
        throw Error("DOWNLOAD_RECOVERY_CONFLICT");
      row.source = { ...source, id };
      row.local = readDownloadCheckpoint(local);
      row.state = "available";
      row.savedAt = Date.now();
      delete row.claim;
      await this.write(row);
      return row;
    });
  }
  claim(user, id) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row) throw Error("DOWNLOAD_RECOVERY_NOT_FOUND");
      if (
        row.state === "claimed" &&
        (row.claim.boot === this.bootId || this.isAlive(row.claim.pid))
      )
        throw Error("DOWNLOAD_RECOVERY_BUSY");
      if (!["available", "claimed"].includes(row.state))
        throw Error("DOWNLOAD_RECOVERY_RECONCILE_REQUIRED");
      row.state = "claimed";
      row.claim = { id: randomUUID(), boot: this.bootId, pid: this.pid };
      await this.write(row);
      return row;
    });
  }
  transition(user, id, claimId, state) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row || row.claim?.id !== claimId)
        throw Error("DOWNLOAD_RECOVERY_CONFLICT");
      const allowed = {
        claimed: ["available", "committing", "cancelled"],
        committing: ["unknown", "completed"],
        unknown: ["completed"],
        available: [],
        completed: [],
        cancelled: [],
      };
      if (!allowed[row.state]?.includes(state))
        throw Error("DOWNLOAD_RECOVERY_CONFLICT");
      row.state = state;
      if (state === "available") delete row.claim;
      await this.write(row);
      return row;
    });
  }
  canReconcile(row) {
    if (
      row.claim &&
      row.claim.boot !== this.bootId &&
      this.isAlive(row.claim.pid)
    )
      throw Error("DOWNLOAD_RECOVERY_BUSY");
  }
  checked(user, id) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (!row || !["committing", "unknown"].includes(row.state))
        throw Error("DOWNLOAD_RECOVERY_RECONCILE_REQUIRED");
      this.canReconcile(row);
      row.state = "completed";
      await this.write(row);
      return row;
    });
  }
  remove(user, id) {
    return this.run(async () => {
      const row = await this.read(user, id);
      if (row && !["completed", "cancelled"].includes(row.state))
        throw Error("DOWNLOAD_RECOVERY_RECONCILE_REQUIRED");
      const dir = await this.directory(user);
      if (dir)
        await fs.unlink(path.join(dir, id + ".recovery")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    });
  }
}
module.exports = { DownloadRecoveryVault };
