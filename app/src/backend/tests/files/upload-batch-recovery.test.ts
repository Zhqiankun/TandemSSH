import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService, type UploadPorts } from "../../files/upload-service";
import { UploadTreeService } from "../../files/upload-tree-service";
import { UploadRecoveryCoordinator } from "../../files/upload-recovery-coordinator";
import { UploadRecoveryStore } from "../../files/upload-recovery-store";
import { UploadBatchRecoveryStore } from "../../files/upload-batch-recovery-store";
import { UploadBatchRecoveryService } from "../../files/upload-batch-recovery-service";
import { FilePathLocks } from "../../files/path-locks";
import type { UploadBatchSourcePort } from "../../files/upload-batch-native-client";
import type {
  NativeUploadSelection,
  NativeUploadEntry,
} from "../../../types/upload-source";
const { UploadSourceStore } = createRequire(import.meta.url)(
  path.resolve(process.cwd(), "electron/upload-sources.cjs"),
);
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  await remote.mkdir("/dest");
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    root = await fs.mkdtemp(path.join(cache, "batch-recovery-")),
    local = path.join(root, "source");
  await fs.mkdir(local);
  await fs.mkdir(path.join(local, "empty"));
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== cache ||
      !path.basename(actual).startsWith("batch-recovery-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const bytes = Buffer.alloc(4194304 + 9, 29);
  await fs.writeFile(path.join(local, "large.bin"), bytes);
  await fs.writeFile(path.join(local, "small.bin"), "next");
  const key = randomBytes(32),
    keys = { load: async () => key },
    sources = new UploadSourceStore();
  cleanup.push(() => sources.reset(1));
  let io = remote.io;
  const ports: UploadPorts = {
    locks: new FilePathLocks(),
    audit: async () => {},
    beginWrite: () => () => {},
    target: async (user, session) => {
      if (user !== actor.userId || !["old", "new"].includes(session))
        throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        io,
        key: "fixture",
        acceptedHostKey: remote.peerKey(),
        connection: session,
        hostScope: { userId: user, identity: "fixture" },
        check: () => {},
      };
    },
  };
  const uploads = new UploadService(ports),
    trees = new UploadTreeService(ports, uploads),
    store = new UploadBatchRecoveryStore(root, keys),
    windows = new UploadRecoveryCoordinator(
      uploads,
      new UploadRecoveryStore(root, keys),
      () => true,
    );
  const native: UploadBatchSourcePort = {
    snapshot: async (_t, id) => ({
      snapshot: JSON.stringify(sources.checkpoint(1, id)),
      selection: sources.view(sources.owned(1, id)),
    }),
    restore: async (_t, id, snapshot) =>
      sources.restore(1, id, JSON.parse(snapshot)),
    forget: async (_t, id) => sources.forget(1, id),
  };
  const batches = new UploadBatchRecoveryService(
      uploads,
      trees,
      store,
      windows,
      native,
    ),
    tokens: string[] = [];
  const window = () => {
    const token = randomUUID();
    tokens.push(token);
    windows.bind(token);
    return token;
  };
  const token = window();
  cleanup.push(
    () => uploads.dispose(),
    () => trees.dispose(),
    async () => {
      for (const token of tokens) await windows.close(token);
    },
  );
  const source: NativeUploadSelection = await sources.select(1, [local]),
    entries = source.entries
      .filter((e) => e.kind === "file" || e.kind === "directory")
      .map(({ id, parentId, name, kind, size, lastModified }) => ({
        id,
        parentId,
        name,
        kind: kind as "file" | "directory",
        size,
        lastModified,
      }));
  const preview = await trees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries,
  });
  await trees.confirm(
    actor,
    preview.id,
    preview.revision,
    preview.entries.map((e) => ({ id: e.id, action: "create" })),
  );
  await trees.directories(actor, preview.id);
  const large = source.entries.find((e) => e.name === "large.bin")!,
    small = source.entries.find((e) => e.name === "small.bin")!;
  const manifest = (e: NativeUploadEntry, body: Buffer) => ({
    name: e.name,
    size: body.length,
    lastModified: e.lastModified,
    hashes: Array.from({ length: Math.ceil(body.length / 4194304) }, (_, i) =>
      createHash("sha256")
        .update(body.subarray(i * 4194304, (i + 1) * 4194304))
        .digest("hex"),
    ),
  });
  const upload = await trees.prepareEntry(
    actor,
    preview.id,
    large.id,
    "old",
    randomUUID(),
    manifest(large, bytes),
  );
  await uploads.start(actor, upload.id, { overwrite: false });
  await uploads.chunk(actor, upload.id, 0, bytes.subarray(0, 4194304));
  await uploads.pause(actor, upload.id);
  const id = randomUUID(),
    save = () =>
      batches.save(actor, token, {
        id,
        treeId: preview.id,
        sourceId: source.id,
        members: [
          { entryId: large.id, uploadId: upload.id },
          { entryId: small.id },
        ],
      });
  const select = async (): Promise<NativeUploadSelection> =>
    sources.select(1, [local]);
  return {
    ports,
    remote,
    root,
    keys,
    bytes,
    uploads,
    trees,
    store,
    windows,
    batches,
    native,
    token,
    window,
    source,
    preview,
    upload,
    large,
    small,
    manifest,
    id,
    save,
    select,
    reconnect: async () => {
      io = (await remote.reconnect()).io;
    },
  };
}
it("saves one encrypted batch, restores paused on a new connection, and completes remaining files", async () => {
  const f = await fixture(),
    saved = await f.save();
  expect(saved.state).toBe("available");
  expect(() => f.uploads.get(actor, f.upload.id)).toThrow("UPLOAD_NOT_FOUND");
  expect(() => f.trees.get(actor, f.preview.id)).toThrow("UPLOAD_NOT_FOUND");
  const folder = path.join(
      f.root,
      "tandem-upload-batches",
      createHash("sha256").update(actor.userId).digest("hex"),
    ),
    cipher = await fs.readFile(path.join(folder, f.id + ".checkpoint"));
  expect(cipher.subarray(0, 4).toString()).toBe("TUB1");
  expect(cipher.includes(Buffer.from("large.bin"))).toBe(false);
  await f.reconnect();
  const token = f.window(),
    selected = await f.select(),
    r = await f.batches.restore(
      actor,
      token,
      f.id,
      "new",
      selected.id,
      true,
      false,
    );
  expect(r.members.find((m) => m.entryId === f.large.id)?.view?.state).toBe(
    "paused",
  );
  await f.batches.directories(actor, r.tree.id, false);
  const large = r.members.find((m) => m.entryId === f.large.id)!.view!;
  await f.batches.resume(actor, large.id, "new");
  f.batches.assertChunk(actor, large.id);
  await f.uploads.chunk(actor, large.id, 4194304, f.bytes.subarray(4194304));
  expect((await f.batches.finish(actor, large.id)).state).toBe("completed");
  f.uploads.forget(actor, large.id);
  const small = await f.batches.prepare(
    actor,
    r.tree.id,
    f.small.id,
    "new",
    randomUUID(),
    f.manifest(f.small, Buffer.from("next")),
  );
  await f.batches.start(actor, small.id, { overwrite: false });
  await f.uploads.chunk(actor, small.id, 0, Buffer.from("next"));
  await f.batches.finish(actor, small.id);
  expect((await f.store.get(actor.userId, f.id))?.state).toBe("completed");
  expect((await f.remote.read("/dest/source/large.bin")).equals(f.bytes)).toBe(
    true,
  );
  expect((await f.remote.read("/dest/source/small.bin")).toString()).toBe(
    "next",
  );
  await f.batches.remove(actor, token, f.id);
  expect(f.batches.ownsTree(r.tree.id)).toBe(false);
  await f.windows.close(token);
});
it("preserves confirmed progress when the recovered window closes and can resume again", async () => {
  const f = await fixture();
  await f.save();
  const token = f.window(),
    selected = await f.select(),
    r = await f.batches.restore(
      actor,
      token,
      f.id,
      "new",
      selected.id,
      true,
      false,
    ),
    file = r.members.find((m) => m.entryId === f.large.id)!.view!;
  await f.batches.resume(actor, file.id, "new");
  await f.uploads.chunk(actor, file.id, 4194304, f.bytes.subarray(4194304));
  await f.windows.close(token);
  const saved = await f.store.get(actor.userId, f.id);
  expect(saved?.state).toBe("available");
  expect(
    saved?.payload.members.find((m) => m.entryId === f.large.id)?.checkpoint
      ?.receivedBytes,
  ).toBe(f.bytes.length);
  expect(() => f.uploads.get(actor, file.id)).toThrow("UPLOAD_NOT_FOUND");
  const nextToken = f.window(),
    choice = await f.select(),
    again = await f.batches.restore(
      actor,
      nextToken,
      f.id,
      "new",
      choice.id,
      true,
      false,
    );
  expect(
    again.members.find((m) => m.entryId === f.large.id)?.view?.receivedBytes,
  ).toBe(f.bytes.length);
});
it("rejects a failed initial durable save without removing live paused work", async () => {
  const f = await fixture();
  vi.spyOn(f.store, "create").mockRejectedValueOnce(Error("DISK_FULL"));
  await expect(f.save()).rejects.toThrow("DISK_FULL");
  expect(f.uploads.get(actor, f.upload.id).state).toBe("paused");
  expect(f.trees.get(actor, f.preview.id).state).toBe("confirmed");
  expect((await f.save()).state).toBe("available");
});
it("journals uncertain commits and only completes them after explicit remote verification", async () => {
  const f = await fixture();
  await f.save();
  const token = f.window(),
    choice = await f.select(),
    r = await f.batches.restore(
      actor,
      token,
      f.id,
      "new",
      choice.id,
      true,
      false,
    ),
    file = r.members.find((m) => m.entryId === f.large.id)!.view!;
  await f.batches.resume(actor, file.id, "new");
  await f.uploads.chunk(actor, file.id, 4194304, f.bytes.subarray(4194304));
  const replace = f.remote.io.replace.bind(f.remote.io);
  vi.spyOn(f.remote.io, "replace").mockImplementationOnce(async (...args) => {
    await replace(...args);
    throw Error("LOST_REPLY");
  });
  expect((await f.batches.finish(actor, file.id)).state).toBe("unknown");
  expect(
    (await f.store.get(actor.userId, f.id))?.payload.members.find(
      (m) => m.entryId === f.large.id,
    )?.state,
  ).toBe("unknown");
  const renames = f.remote.renames(),
    checked = await f.batches.check(actor, token, f.id, "new", false);
  expect(
    checked.tree.entries.find((e) => e.id === f.large.id)?.fileResult?.state,
  ).toBe("completed");
  expect(f.remote.renames()).toBe(renames);
});
it("allows only one live claim across independent store instances", async () => {
  const f = await fixture();
  await f.save();
  const other = new UploadBatchRecoveryStore(f.root, f.keys);
  const results = await Promise.allSettled([
    f.store.claim(actor.userId, f.id),
    other.claim(actor.userId, f.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await other.list("other-user")).toEqual([]);
});
it("requires a live owned window and fresh review before restoring", async () => {
  const f = await fixture();
  await f.save();
  await expect(f.batches.list(actor, randomUUID())).rejects.toThrow(
    "UPLOAD_RECOVERY_WINDOW_CLOSED",
  );
  await expect(f.batches.list({ userId: "other" }, f.token)).rejects.toThrow(
    "UPLOAD_RECOVERY_WINDOW_CLOSED",
  );
  const selected = await f.select();
  await expect(
    f.batches.restore(actor, f.token, f.id, "new", selected.id, false, false),
  ).rejects.toThrow("UPLOAD_BATCH_REVIEW_REQUIRED");
  expect((await f.store.get(actor.userId, f.id))?.state).toBe("available");
});

it("keeps cancelled pending members cancelled when the batch is later recovered", async () => {
  const f = await fixture();
  await f.save();
  const token = f.window(),
    choice = await f.select(),
    r = await f.batches.restore(
      actor,
      token,
      f.id,
      "new",
      choice.id,
      true,
      false,
    );
  await f.batches.cancelTree(actor, r.tree.id);
  const record = await f.store.get(actor.userId, f.id);
  expect(
    record?.payload.members.find((m) => m.entryId === f.small.id)?.state,
  ).toBe("cancelled");
  expect(record?.state).toBe("available");
  const nextChoice = await f.select(),
    again = await f.batches.restore(
      actor,
      token,
      f.id,
      "new",
      nextChoice.id,
      true,
      false,
    );
  expect(again.members.find((m) => m.entryId === f.small.id)?.state).toBe(
    "cancelled",
  );
  expect(again.tree.entries.find((e) => e.id === f.small.id)?.action).toBe(
    "skip",
  );
});
it("reconciles an uncertain saved directory as an existing merge after checking the real target", async () => {
  const f = await fixture();
  await f.save();
  const claim = await f.store.claim(actor.userId, f.id),
    directory = claim.payload.tree.entries.find(
      (e) => e.view.kind === "directory",
    )!;
  await f.store.change(actor.userId, f.id, claim.claim!.id, (r) => {
    const e = r.payload.tree.entries.find(
      (e) => e.view.id === directory.view.id,
    )!;
    e.view.result = { state: "unknown", error: "LOST_REPLY" };
    delete e.directory;
    r.state = "available";
    delete r.claim;
  });
  const checked = await f.batches.check(actor, f.token, f.id, "new", false);
  expect(
    checked.tree.entries.find((e) => e.id === directory.view.id)?.result?.state,
  ).toBe("merged");
  expect((await f.store.get(actor.userId, f.id))?.state).toBe("available");
});

it("isolates active batches when two users choose the same recovery record ID", async () => {
  const f = await fixture();
  await f.save();
  const tokenA = f.window(),
    choiceA = await f.select();
  await f.batches.restore(actor, tokenA, f.id, "new", choiceA.id, true, false);
  const other = { userId: "other" },
    original = f.ports.target;
  f.ports.target = async (user, session) =>
    user === other.userId
      ? {
          ...(await original(actor.userId, session)),
          key: "other-fixture",
          hostScope: { userId: user, identity: "other" },
        }
      : original(user, session);
  await f.remote.mkdir("/other");
  const tokenB = f.window(),
    source = await f.select(),
    entries = source.entries
      .filter((e) => e.kind === "file" || e.kind === "directory")
      .map(({ id, parentId, name, kind, size, lastModified }) => ({
        id,
        parentId,
        name,
        kind: kind as "file" | "directory",
        size,
        lastModified,
      })),
    tree = await f.trees.preview(other, {
      sessionId: "new",
      path: "/other",
      entries,
    });
  await f.trees.confirm(
    other,
    tree.id,
    tree.revision,
    tree.entries.map((e) => ({ id: e.id, action: "create" })),
  );
  await f.trees.directories(other, tree.id);
  await f.batches.save(other, tokenB, {
    id: f.id,
    treeId: tree.id,
    sourceId: source.id,
    members: entries
      .filter((e) => e.kind === "file")
      .map((e) => ({ entryId: e.id })),
  });
  const choiceB = await f.select();
  await f.batches.restore(other, tokenB, f.id, "new", choiceB.id, true, false);
  await f.windows.close(tokenA);
  expect((await f.store.get(actor.userId, f.id))?.state).toBe("available");
  expect((await f.store.get(other.userId, f.id))?.state).toBe("claimed");
});
