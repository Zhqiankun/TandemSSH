const fs = require("node:fs/promises"),
  path = require("node:path"),
  { createHash, randomUUID } = require("node:crypto");
const { validateDownloadBatch } = require("./download-batch-record.cjs");
const generated = /^[a-f0-9-]{36}\.recovery$/,
  maximum = 32 * 1024 * 1024,
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
class DownloadBatchVault {
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
    if (this.pending >= 8) throw Error("DOWNLOAD_BATCH_BUSY");
    this.pending++;
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    try {
      return await next;
    } finally {
      this.pending--;
    }
  }
  locked(user, work) {
    return this.run(async () => {
      const release = await this.lease(user);
      try {
        return await work();
      } finally {
        await release();
      }
    });
  }
  available() {
    if (
      !this.crypto.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        this.crypto.getSelectedStorageBackend?.() === "basic_text")
    )
      throw Error("DOWNLOAD_BATCH_ENCRYPTION_UNAVAILABLE");
  }

  async lease(user) {
    const dir = await this.directory(user, true),
      lock = path.join(dir, ".writer"),
      owner = process.pid + "-" + randomUUID() + ".owner";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.mkdir(lock);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const info = await fs.lstat(lock);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw Error("DOWNLOAD_BATCH_PATH_INVALID");
        const names = await fs.readdir(lock);
        for (const name of names) {
          const match = /^([1-9][0-9]*)-[a-f0-9-]{36}\.owner$/.exec(name);
          if (!match || this.isAlive(Number(match[1])))
            throw Error("DOWNLOAD_BATCH_BUSY");
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
          throw Error("DOWNLOAD_BATCH_BUSY");
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
        if (error.code === "ENOENT") continue;
        throw error;
      }
    }
    throw Error("DOWNLOAD_BATCH_BUSY");
  }
  async directory(user, create = false) {
    if (typeof user !== "string" || !user || user.length > 256)
      throw Error("DOWNLOAD_BATCH_INVALID");
    const scope = createHash("sha256").update(user).digest("hex"),
      dir = path.join(this.root, scope);
    if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const actual = await fs.realpath(dir),
        root = await fs.realpath(this.root),
        normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
      if (normalize(path.relative(root, actual)) !== scope)
        throw Error("DOWNLOAD_BATCH_PATH_INVALID");
      return dir;
    } catch (e) {
      if (!create && e.code === "ENOENT") return undefined;
      throw e;
    }
  }
  validate(row, user, id) {
    return validateDownloadBatch(row, user, id);
  }
  async read(user, id) {
    if (!uuid.test(id)) throw Error("DOWNLOAD_BATCH_INVALID");
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
        throw Error("DOWNLOAD_BATCH_CORRUPT");
      handle = await fs.open(file, "r");
      const after = await handle.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.nlink !== 1 ||
        after.size > maximum
      )
        throw Error("DOWNLOAD_BATCH_CORRUPT");
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
        throw Error("DOWNLOAD_BATCH_CORRUPT");
      this.available();
      let row;
      try {
        row = JSON.parse(this.crypto.decryptString(bytes));
      } catch {
        throw Error("DOWNLOAD_BATCH_DECRYPT_FAILED");
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
      throw Error("DOWNLOAD_BATCH_LIMIT");
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
      (!previous && files.length >= 8) ||
      total - previous + bytes.length > 256 * 1024 * 1024
    )
      throw Error("DOWNLOAD_BATCH_LIMIT");
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
    const dirs = row.target.entries.filter((e) => e.kind === "directory");
    return {
      id: row.id,
      name: row.source.entries
        .filter((e) => !e.view.parentId)
        .map((e) => e.view.name)
        .join(", "),
      hostLabel: row.source.hostIdentity || "SSH",
      localPath: row.target.path,
      entries: row.source.entries.length,
      completed:
        row.members.filter((m) => m.state === "completed").length +
        dirs.filter((e) => ["created", "merged"].includes(e.result?.state))
          .length,
      paused: row.members.filter((m) => m.state === "paused").length,
      unknown:
        row.members.filter((m) => ["unknown", "committing"].includes(m.state))
          .length + dirs.filter((e) => e.result?.state === "unknown").length,
      state:
        ["preparing", "claimed"].includes(row.state) &&
        row.claim?.boot !== this.bootId &&
        !this.isAlive(row.claim.pid)
          ? "interrupted"
          : row.state,
      savedAt: row.savedAt,
      existing: row.target.entries.some(
        (e) => e.snapshot && e.result?.state !== "completed",
      ),
    };
  }
  list(user) {
    return this.run(async () => {
      const dir = await this.directory(user);
      if (!dir) return [];
      const rows = [];
      for (const name of (await fs.readdir(dir))
        .filter((f) => generated.test(f))
        .slice(0, 8)) {
        const row = await this.read(user, name.slice(0, -9));
        if (row) rows.push(this.summary(row));
      }
      return rows.sort((a, b) => b.savedAt - a.savedAt);
    });
  }
  create(user, id, source, target, members) {
    return this.locked(user, async () => {
      if (await this.read(user, id)) throw Error("DOWNLOAD_BATCH_CONFLICT");
      const row = {
        schemaVersion: 1,
        id,
        userId: user,
        source,
        target,
        members,
        state: "preparing",
        claim: { id: randomUUID(), boot: this.bootId, pid: this.pid },
        savedAt: Date.now(),
      };
      this.validate(row, user, id);
      await this.write(row);
      return row;
    });
  }
  claim(user, id) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (!row) throw Error("DOWNLOAD_BATCH_NOT_FOUND");
      if (
        ["preparing", "claimed"].includes(row.state) &&
        (row.claim?.boot === this.bootId || this.isAlive(row.claim.pid))
      )
        throw Error("DOWNLOAD_BATCH_BUSY");
      if (!["available", "preparing", "claimed"].includes(row.state))
        throw Error("DOWNLOAD_BATCH_NOT_AVAILABLE");
      row.state = "claimed";
      row.claim = { id: randomUUID(), boot: this.bootId, pid: this.pid };
      await this.write(row);
      return row;
    });
  }
  change(user, id, claimId, work) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (
        !row ||
        row.claim?.id !== claimId ||
        !["preparing", "claimed"].includes(row.state)
      )
        throw Error("DOWNLOAD_BATCH_CONFLICT");
      const identity = (r) =>
        JSON.stringify([
          r.userId,
          r.source.targetKey,
          r.source.peer,
          r.source.entries.map((e) => [
            e.view.id,
            e.view.path,
            e.view.kind,
            e.view.size,
          ]),
          r.target.path,
          r.target.identity,
          r.target.entries.map((e) => [
            e.id,
            e.parentId,
            e.name,
            e.kind,
            e.size,
          ]),
        ]);
      const before = identity(row);
      work(row);
      if (identity(row) !== before) throw Error("DOWNLOAD_BATCH_CONFLICT");
      row.savedAt = Date.now();
      this.validate(row, user, id);
      await this.write(row);
      return row;
    });
  }
  release(user, id, claimId) {
    return this.change(user, id, claimId, (row) => {
      row.state = "available";
      delete row.claim;
    });
  }
  remove(user, id) {
    return this.locked(user, async () => {
      const row = await this.read(user, id);
      if (row && !["completed", "cancelled"].includes(row.state))
        throw Error("DOWNLOAD_BATCH_NOT_AVAILABLE");
      const dir = await this.directory(user);
      if (dir)
        await fs.unlink(path.join(dir, id + ".recovery")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    });
  }
}
module.exports = { DownloadBatchVault };
