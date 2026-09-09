import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { EventEmitter } from "node:events";
import { DownloadService } from "../src/backend/files/download-service";
import { DownloadRecoveryTickets } from "../src/backend/files/download-recovery-tickets";
import { registerDownloadRecoveryBridge } from "../src/backend/files/download-recovery-bridge";
import { fileSftpFixture } from "../src/backend/test-helpers/file-sftp-fixture";
const require = createRequire(import.meta.url),
  { DownloadSink, CHUNK_BYTES } = require("../electron/download-sink.cjs"),
  {
    createDownloadRecovery,
  } = require("../electron/download-recovery-controller.cjs"),
  {
    DownloadRecoveryVault,
  } = require("../electron/download-recovery-vault.cjs");
const closes: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0).reverse()) await close();
});
function cryptoPort() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv),
        data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString: (bytes: Buffer) => {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString("utf8");
    },
  };
}
async function fixture() {
  const cache = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.cache",
    ),
    root = await fs.mkdtemp(path.join(cache, "download-flow-"));
  closes.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== (await fs.realpath(cache)) ||
      !path.basename(actual).startsWith("download-flow-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const remote = await fileSftpFixture();
  closes.push(() => remote.close());
  const bytes = Buffer.alloc(CHUNK_BYTES + 17, 73);
  await remote.write("/source.bin", bytes);
  let holds = 0;
  const downloads = new DownloadService({
    target: async (user) => {
      if (user !== "owner") throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        key: "fixture-key",
        connection: "connection",
        acceptedHostKey: remote.peerKey(),
        hostScope: { userId: user, identity: "fixture@host" },
        io: remote.io,
        check: () => {},
        retain: () => {
          holds++;
          return () => {
            holds--;
          };
        },
      };
    },
    audit: async () => {},
  });
  closes.push(() => downloads.dispose());
  const tickets = new DownloadRecoveryTickets(downloads, () => true),
    parent = new EventEmitter() as EventEmitter & {
      connected: boolean;
      send: (m: unknown, cb: (e: Error | null) => void) => void;
    },
    child = new EventEmitter();
  parent.connected = true;
  parent.send = (m, cb) => {
    queueMicrotask(() => child.emit("message", m));
    cb(null);
  };
  const unbind = registerDownloadRecoveryBridge(tickets, {
    on: (e, l) => child.on(e, l),
    removeListener: (e, l) => child.removeListener(e, l),
    send: (m, cb) => {
      queueMicrotask(() => parent.emit("message", m));
      cb(null);
    },
  });
  closes.push(unbind);
  const crypto = cryptoPort(),
    vaultRoot = path.join(root, "vault");
  const app = (owner: number) => {
    const sink = new DownloadSink(),
      controller = createDownloadRecovery({
        sink,
        getBackend: () => parent,
        root: vaultRoot,
        crypto,
      }),
      scoped = { id: owner, life: { epoch: 0 } };
    closes.push(async () => {
      await sink.reset(owner);
      await controller.reset(owner);
    });
    const call = async (
      kind: string,
      args: Record<string, unknown> = {},
      intent: Record<string, unknown> = {},
      user = "owner",
    ) => {
      const { windowToken } = await controller.handle(scoped, "identity"),
        { ticketId } = tickets.issue(user, { windowToken, kind, ...intent });
      return controller.handle(scoped, kind, ticketId, args);
    };
    return {
      sink,
      controller,
      scoped,
      call,
      reset: async () => {
        scoped.life.epoch++;
        await sink.reset(owner);
        await controller.reset(owner);
      },
    };
  };
  const first = app(1),
    source = await downloads.prepare(
      { userId: "owner" },
      { sessionId: "session", requestId: randomUUID(), path: "/source.bin" },
    ),
    local = await first.sink.choose(
      1,
      {
        name: "result.bin",
        size: source.size,
        sha256: source.sha256,
        hashes: source.hashes,
      },
      async () => path.join(root, "result.bin"),
    );
  await first.sink.start(1, local.id, false);
  await first.sink.append(
    1,
    local.id,
    0,
    await downloads.chunk({ userId: "owner" }, source.id, 0),
  );
  await first.sink.pause(1, local.id);
  await downloads.pause({ userId: "owner" }, source.id);
  return {
    root,
    remote,
    bytes,
    downloads,
    tickets,
    first,
    source,
    local,
    app,
    crypto,
    vaultRoot,
    holds: () => holds,
  };
}
it("saves encrypted progress through a one-use window ticket and restores without auto-running", async () => {
  const f = await fixture();
  const saved = await f.first.call(
    "save",
    { localId: f.local.id },
    { sourceId: f.source.id },
  );
  expect(saved.state).toBe("available");
  expect(() => f.first.sink.owned(1, f.local.id)).toThrow("DOWNLOAD_NOT_FOUND");
  const files = await fs.readdir(f.vaultRoot),
    record = await fs.readFile(
      path.join(f.vaultRoot, files[0], saved.id + ".recovery"),
    );
  expect(record.includes(Buffer.from("/source.bin"))).toBe(false);
  expect(record.includes(Buffer.from(f.root))).toBe(false);
  expect(await f.first.call("list", {}, {}, "other")).toEqual([]);
  await f.first.reset();
  const next = f.app(2),
    restored = await next.call(
      "restore",
      { id: saved.id, overwrite: false },
      { sessionId: "session" },
    );
  expect(restored.local.state).toBe("paused");
  expect(restored.local.writtenBytes).toBe(CHUNK_BYTES);
  expect(restored.local.id).not.toBe(f.local.id);
  await expect(
    next.call(
      "restore",
      { id: saved.id, overwrite: false },
      { sessionId: "session" },
    ),
  ).rejects.toThrow("DOWNLOAD_RECOVERY_BUSY");
  await next.reset();
  expect(f.holds()).toBe(0);
  expect((await f.first.call("list"))[0].state).toBe("available");
}, 15000);
it("can update a recovered checkpoint without creating a duplicate record", async () => {
  const f = await fixture(),
    saved = await f.first.call(
      "save",
      { localId: f.local.id },
      { sourceId: f.source.id },
    ),
    next = f.app(2),
    r = await next.call(
      "restore",
      { id: saved.id, overwrite: false },
      { sessionId: "session" },
    );
  await next.sink.resume(2, r.local.id);
  await next.sink.append(
    2,
    r.local.id,
    CHUNK_BYTES,
    await f.downloads.chunk({ userId: "owner" }, r.source.id, CHUNK_BYTES),
  );
  await next.sink.pause(2, r.local.id);
  await f.downloads.pause({ userId: "owner" }, r.source.id);
  const updated = await next.call(
    "save",
    { localId: r.local.id },
    { sourceId: r.source.id },
  );
  expect(updated.id).toBe(saved.id);
  expect(updated.writtenBytes).toBe(f.bytes.length);
  expect(await next.call("list")).toHaveLength(1);
  const retry = await next.call(
    "save",
    { localId: r.local.id },
    { sourceId: r.source.id },
  );
  expect(retry.id).toBe(saved.id);
}, 15000);
it("journals an uncertain commit and reconciles it without writing the destination again", async () => {
  const f = await fixture(),
    saved = await f.first.call(
      "save",
      { localId: f.local.id },
      { sourceId: f.source.id },
    ),
    next = f.app(2),
    r = await next.call(
      "restore",
      { id: saved.id, overwrite: false },
      { sessionId: "session" },
    );
  await next.sink.resume(2, r.local.id);
  await next.sink.append(
    2,
    r.local.id,
    CHUNK_BYTES,
    await f.downloads.chunk({ userId: "owner" }, r.source.id, CHUNK_BYTES),
  );
  await f.downloads.verify({ userId: "owner" }, r.source.id);
  await next.controller.beforeFinish(2, r.local.id);
  const copy = fs.copyFile.bind(fs),
    fault = vi.spyOn(fs, "copyFile").mockImplementationOnce(async (...args) => {
      await copy(...args);
      throw Object.assign(Error("lost reply"), { code: "EIO" });
    });
  await expect(next.sink.finish(2, r.local.id)).rejects.toThrow();
  fault.mockRestore();
  next.controller.finishFailed(2, r.local.id);
  expect((await next.call("list"))[0].state).toBe("committing");
  await expect(
    next.call(
      "restore",
      { id: saved.id, overwrite: false },
      { sessionId: "session" },
    ),
  ).rejects.toThrow("DOWNLOAD_RECOVERY_RECONCILE_REQUIRED");
  const checked = await next.call("check", { id: saved.id });
  expect(checked.summary.state).toBe("completed");
  expect(checked.summary.writtenBytes).toBe(f.bytes.length);
  expect(checked.local.state).toBe("completed");
  expect(
    (await fs.readFile(path.join(f.root, "result.bin"))).equals(f.bytes),
  ).toBe(true);
  await next.call("remove", { id: saved.id });
  expect(await next.call("list")).toEqual([]);
}, 15000);
it("rejects forged or reused window tickets and preserves partial files when encryption is unavailable", async () => {
  const f = await fixture();
  expect(() =>
    f.tickets.issue("owner", { windowToken: randomUUID(), kind: "list" }),
  ).toThrow("DOWNLOAD_DESKTOP_REQUIRED");
  const identity = await f.first.controller.handle(f.first.scoped, "identity"),
    ticket = f.tickets.issue("owner", {
      windowToken: identity.windowToken,
      kind: "list",
    });
  f.tickets.claim(identity.windowToken, ticket.ticketId);
  expect(() => f.tickets.claim(identity.windowToken, ticket.ticketId)).toThrow(
    "DOWNLOAD_RECOVERY_TICKET_USED",
  );
  const availability = vi
    .spyOn(f.crypto, "isEncryptionAvailable")
    .mockReturnValue(false);
  await expect(
    f.first.call("save", { localId: f.local.id }, { sourceId: f.source.id }),
  ).rejects.toThrow("DOWNLOAD_RECOVERY_ENCRYPTION_UNAVAILABLE");
  expect(f.first.sink.owned(1, f.local.id).view.temporaryPath).toBeTruthy();
  availability.mockRestore();
});
it("blocks live process claims, recovers dead process claims, and discards only the owned part", async () => {
  const f = await fixture(),
    saved = await f.first.call(
      "save",
      { localId: f.local.id },
      { sourceId: f.source.id },
    );
  const first = new DownloadRecoveryVault({
    root: f.vaultRoot,
    crypto: f.crypto,
    bootId: randomUUID(),
    pid: 111,
    isAlive: () => true,
  });
  await first.claim("owner", saved.id);
  const second = new DownloadRecoveryVault({
    root: f.vaultRoot,
    crypto: f.crypto,
    bootId: randomUUID(),
    pid: 222,
    isAlive: () => true,
  });
  await expect(second.claim("owner", saved.id)).rejects.toThrow(
    "DOWNLOAD_RECOVERY_BUSY",
  );
  second.isAlive = () => false;
  expect((await second.list("owner"))[0].state).toBe("interrupted");
  const claimed = await second.claim("owner", saved.id);
  await second.transition("owner", saved.id, claimed.claim.id, "available");
  const before = await first.read("owner", saved.id);
  await f.first.call("discard", { id: saved.id });
  await expect(fs.stat(before.local.stagePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await f.first.call("list"))[0].state).toBe("cancelled");
});
