import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileSftpFixture } from "../src/backend/test-helpers/file-sftp-fixture";
import {
  DownloadService,
  type DownloadPorts,
} from "../src/backend/files/download-service";
import { DownloadTreeService } from "../src/backend/files/download-tree-service";
import { DownloadRecoveryTickets } from "../src/backend/files/download-recovery-tickets";
import { DownloadBatchRecoveryTickets } from "../src/backend/files/download-batch-recovery-tickets";
import { registerDownloadBatchRecoveryBridge } from "../src/backend/files/download-batch-recovery-bridge";
import {
  sealRecord,
  openRecord,
} from "../src/backend/privacy/encrypted-record-codec";
const require = createRequire(import.meta.url),
  { DownloadSink } = require("../electron/download-sink.cjs"),
  {
    DownloadDirectoryTargets,
  } = require("../electron/download-directory-targets.cjs"),
  {
    createDownloadBatchRecovery,
  } = require("../electron/download-batch-recovery-controller.cjs"),
  cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  const bytes = Buffer.alloc(4194304 + 19, 17);
  await remote.mkdir("/source/empty");
  await remote.write("/source/large.bin", bytes);
  await remote.write("/source/small.bin", "done");
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    root = await fs.mkdtemp(path.join(cache, "download-batch-controller-")),
    destination = path.join(root, "target");
  await fs.mkdir(destination);
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== cache ||
      !path.basename(actual).startsWith("download-batch-controller-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const actor = { userId: "owner" },
    ports: DownloadPorts = {
      target: async (user, session) => {
        if (user !== actor.userId) throw Error("FILE_SESSION_UNAVAILABLE");
        return {
          io: remote.io,
          key: "fixture",
          acceptedHostKey: remote.peerKey(),
          connection: session,
          check: () => {},
        };
      },
      audit: async () => {},
    },
    downloads = new DownloadService(ports),
    trees = new DownloadTreeService(ports, downloads),
    windows = new DownloadRecoveryTickets(downloads, () => true),
    tickets = new DownloadBatchRecoveryTickets(trees, downloads, windows);
  cleanup.push(
    () => downloads.dispose(),
    () => trees.dispose(),
    () => windows.dispose(),
  );
  const requests = new EventEmitter(),
    backend = Object.assign(new EventEmitter(), {
      connected: true,
      send: (message: unknown, cb: (e: null) => void) => {
        cb(null);
        queueMicrotask(() => requests.emit("message", message));
      },
    });
  const bridge = registerDownloadBatchRecoveryBridge(tickets, {
    on: (event, fn) => requests.on(event, fn),
    removeListener: (event, fn) => requests.removeListener(event, fn),
    send: (message, cb) => {
      cb(null);
      queueMicrotask(() => backend.emit("message", message));
    },
  });
  cleanup.push(bridge);
  const key = randomBytes(32),
    sink = new DownloadSink(),
    directories = new DownloadDirectoryTargets(sink),
    life = { epoch: 0 },
    scoped = { id: 1, life };
  let token = randomUUID();
  windows.bind(token);
  const recovery = {
      scopeFor: async () => {
        const expected = life.epoch;
        return {
          value: { backend, token },
          guard: () => {
            if (life.epoch !== expected) throw Error("DOWNLOAD_CANCELLED");
          },
        };
      },
    },
    controller = createDownloadBatchRecovery({
      sink,
      directories,
      recovery,
      root: path.join(root, "records"),
      crypto: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => sealRecord(s, key, "TDB1", "test"),
        decryptString: (b: Buffer) => openRecord(b, key, "TDB1", "test"),
      },
    });
  cleanup.push(async () => {
    await controller.reset(1);
    await directories.reset(1);
    await sink.reset(1);
  });
  const source = await trees.scan(actor, {
      sessionId: "session",
      paths: ["/source"],
    }),
    selected = await directories.choose(1, async () => destination),
    target = await directories.preview(
      1,
      selected.id,
      source.entries
        .filter((e) => e.kind === "file" || e.kind === "directory")
        .map((e) => ({
          id: e.id,
          parentId: e.parentId,
          name: e.name,
          kind: e.kind,
          size: e.size,
        })),
    );
  directories.confirm(
    1,
    target.id,
    target.revision,
    target.entries.map((e: { id: string }) => ({ id: e.id, action: "create" })),
  );
  await directories.directories(1, target.id);
  const entry = source.entries.find((e) => e.name === "large.bin")!,
    remoteSource = await trees.prepareEntry(
      actor,
      source.id,
      entry.id,
      randomUUID(),
      "session",
    ),
    local = await directories.file(1, target.id, entry.id, {
      name: entry.name,
      size: remoteSource.size,
      sha256: remoteSource.sha256,
      hashes: remoteSource.hashes,
    });
  await sink.start(1, local.id, false);
  await sink.append(1, local.id, 0, bytes.subarray(0, 4194304));
  await sink.pause(1, local.id);
  await downloads.pause(actor, remoteSource.id);
  const request = (kind: string, intent: object = {}, args: object = {}) => {
    const t = tickets.issue(actor.userId, {
      windowToken: token,
      kind,
      ...intent,
    });
    return controller.handle(scoped, kind, t.ticketId, args);
  };
  const save = () =>
    request(
      "save",
      {
        treeId: source.id,
        sources: [{ entryId: entry.id, sourceId: remoteSource.id }],
      },
      {
        targetId: target.id,
        members: [{ entryId: entry.id, localId: local.id }],
      },
    );
  const restore = async (id: string) => {
    life.epoch++;
    token = randomUUID();
    windows.bind(token);
    const selected = await directories.choose(1, async () => destination);
    return request(
      "restore",
      { sessionId: "session" },
      { id, targetId: selected.id, reviewed: true, overwrite: false },
    );
  };
  return {
    root,
    destination,
    actor,
    bytes,
    remote,
    downloads,
    trees,
    sink,
    directories,
    controller,
    life,
    source,
    entry,
    remoteSource,
    local,
    target,
    request,
    save,
    restore,
  };
}
it("saves a batch through the private source bridge and restores local parts paused", async () => {
  const f = await fixture(),
    saved = await f.save();
  expect(saved.state).toBe("available");
  const restored = await f.restore(saved.id),
    member = restored.members.find(
      (m: { entryId: string }) => m.entryId === f.entry.id,
    );
  expect(member.local.state).toBe("paused");
  await f.controller.beforeDirectories(1, restored.target.id);
  await f.directories.directories(1, restored.target.id);
  await f.controller.afterDirectories(1, restored.target.id);
  await f.downloads.verify(f.actor, member.source.id, "session");
  let local = await f.sink.resume(1, member.local.id);
  await f.controller.afterStart(1, local.id, local);
  await f.sink.append(1, local.id, 4194304, f.bytes.subarray(4194304));
  await f.downloads.verify(f.actor, member.source.id);
  await f.controller.beforeFinish(1, local.id);
  local = await f.sink.finish(1, local.id);
  await f.controller.afterFinish(1, local.id, local);
  expect(f.directories.complete(1, restored.target.id, f.entry.id).state).toBe(
    "completed",
  );
  expect(
    (await fs.readFile(path.join(f.destination, "source/large.bin"))).equals(
      f.bytes,
    ),
  ).toBe(true);
});
it("keeps recovered partial files when their window scope is reset", async () => {
  const f = await fixture(),
    saved = await f.save(),
    r = await f.restore(saved.id),
    m = r.members.find((m: { entryId: string }) => m.entryId === f.entry.id);
  f.life.epoch++;
  expect(() => f.controller.assertFile(1, m.local.id, "append")).toThrow(
    "DOWNLOAD_CANCELLED",
  );
  await f.controller.reset(1);
  await f.directories.reset(1);
  await f.sink.reset(1);
  expect((await fs.stat(m.local.temporaryPath)).size).toBe(4194304);
  const row = await f.controller.vault.read("owner", saved.id);
  expect(row.state).toBe("available");
  expect(
    row.members.find((v: { entryId: string }) => v.entryId === f.entry.id).local
      .writtenBytes,
  ).toBe(4194304);
});
it("does not release live paused files when durable saving fails", async () => {
  const f = await fixture();
  vi.spyOn(f.controller.vault, "create").mockRejectedValueOnce(
    Error("DOWNLOAD_DISK_FULL"),
  );
  await expect(f.save()).rejects.toThrow("DOWNLOAD_DISK_FULL");
  expect(f.sink.view(f.sink.owned(1, f.local.id)).state).toBe("paused");
  expect(f.directories.view(f.directories.owned(1, f.target.id)).state).toBe(
    "ready",
  );
});

it("releases the commit gate after source verification fails so a paused member can resume", async () => {
  const f = await fixture(),
    saved = await f.save(),
    restored = await f.restore(saved.id),
    m = restored.members.find(
      (m: { entryId: string }) => m.entryId === f.entry.id,
    );
  await expect(f.controller.beforeFinish(1, m.local.id)).rejects.toThrow();
  expect(() => f.controller.assertFile(1, m.local.id, "resume")).not.toThrow();
  const row = await f.controller.vault.read("owner", saved.id);
  expect(
    row.members.find((m: { entryId: string }) => m.entryId === f.entry.id)
      .state,
  ).toBe("paused");
});
it("cancels recovered and pending members together without deleting completed directories", async () => {
  const f = await fixture(),
    saved = await f.save(),
    restored = await f.restore(saved.id),
    m = restored.members.find(
      (m: { entryId: string }) => m.entryId === f.entry.id,
    );
  const result = await f.directories.cancel(1, restored.target.id);
  await f.controller.afterCancelTree(1, restored.target.id, result);
  const row = await f.controller.vault.read("owner", saved.id);
  expect(row.state).toBe("cancelled");
  expect(
    row.members.every(
      (m: { state: string; local?: unknown }) =>
        m.state === "cancelled" && !m.local,
    ),
  ).toBe(true);
  await expect(fs.stat(m.local.temporaryPath)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    (await fs.stat(path.join(f.destination, "source/empty"))).isDirectory(),
  ).toBe(true);
  await f.request("remove", {}, { id: saved.id });
  expect(await f.controller.vault.read("owner", saved.id)).toBeNull();
});

it("restores a completed sibling as a verified result without rewriting it", async () => {
  const f = await fixture(),
    entry = f.source.entries.find((e) => e.name === "small.bin")!,
    source = await f.trees.prepareEntry(
      f.actor,
      f.source.id,
      entry.id,
      randomUUID(),
      "session",
    );
  const local = await f.directories.file(1, f.target.id, entry.id, {
    name: entry.name,
    size: source.size,
    sha256: source.sha256,
    hashes: source.hashes,
  });
  await f.sink.start(1, local.id, false);
  await f.sink.append(1, local.id, 0, Buffer.from("done"));
  await f.downloads.verify(f.actor, source.id);
  await f.sink.finish(1, local.id);
  f.directories.complete(1, f.target.id, entry.id);
  const before = await fs.stat(local.path),
    saved = await f.save(),
    restored = await f.restore(saved.id),
    completed = restored.members.find(
      (m: { entryId: string }) => m.entryId === entry.id,
    );
  expect(completed).toMatchObject({
    state: "completed",
    local: { state: "completed", sha256: source.sha256, writtenBytes: 4 },
  });
  expect(
    restored.target.entries.find((e: { id: string }) => e.id === entry.id),
  ).toMatchObject({ action: "skip", result: { state: "completed" } });
  const after = await fs.stat(local.path);
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(await fs.readFile(local.path, "utf8")).toBe("done");
});

it("finishes directory-only reconciliation when every file already has a completed receipt", async () => {
  const f = await fixture();
  await f.sink.resume(1, f.local.id);
  await f.sink.append(1, f.local.id, 4194304, f.bytes.subarray(4194304));
  await f.sink.finish(1, f.local.id);
  f.directories.complete(1, f.target.id, f.entry.id);
  const small = f.source.entries.find((e) => e.name === "small.bin")!,
    remote = await f.trees.prepareEntry(
      f.actor,
      f.source.id,
      small.id,
      randomUUID(),
      "session",
    ),
    local = await f.directories.file(1, f.target.id, small.id, {
      name: small.name,
      size: remote.size,
      sha256: remote.sha256,
      hashes: remote.hashes,
    });
  await f.sink.start(1, local.id, false);
  await f.sink.append(1, local.id, 0, Buffer.from("done"));
  await f.sink.finish(1, local.id);
  f.directories.complete(1, f.target.id, small.id);
  const saved = await f.request(
      "save",
      { treeId: f.source.id, sources: [] },
      { targetId: f.target.id, members: [] },
    ),
    completed = await f.controller.vault.read("owner", saved.id),
    id = randomUUID();
  completed.target.entries.find(
    (e: { kind: string }) => e.kind === "directory",
  ).result = { state: "unknown" };
  const record = await f.controller.vault.create(
    "owner",
    id,
    completed.source,
    completed.target,
    completed.members,
  );
  await f.controller.vault.release("owner", id, record.claim.id);
  const checked = await f.request("check", {}, { id });
  expect(checked.summary).toMatchObject({
    state: "completed",
    unknown: 0,
    completed: 4,
  });
});
