import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { UploadSourceStore } = require("../electron/upload-sources.cjs"),
  { DownloadSink } = require("../electron/download-sink.cjs"),
  {
    DownloadDirectoryTargets,
  } = require("../electron/download-directory-targets.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
interface Entry {
  id: string;
  parentId?: string;
  kind: string;
  name: string;
  path?: string;
  status: string;
  result?: { state: string };
}
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const spec = (bytes: Buffer) => ({
  name: "source.bin",
  size: bytes.length,
  sha256: digest(bytes),
  hashes: Array.from({ length: Math.ceil(bytes.length / 4194304) }, (_, i) =>
    digest(bytes.subarray(i * 4194304, (i + 1) * 4194304)),
  ),
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    root = await fs.mkdtemp(path.join(cache, "directory-recovery-native-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== cache ||
      !path.basename(actual).startsWith("directory-recovery-native-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const create = () => {
    const sources = new UploadSourceStore(),
      sink = new DownloadSink(),
      targets = new DownloadDirectoryTargets(sink);
    cleanup.push(
      () => sources.reset(1),
      () => sink.reset(1),
      () => targets.reset(1),
    );
    return { sources, sink, targets };
  };
  return { root, create, ...create() };
}
it("rebinds a newly selected upload directory to original member IDs without adopting newly added files", async () => {
  const f = await fixture(),
    source = path.join(f.root, "项目");
  await fs.mkdir(path.join(source, "empty"), { recursive: true });
  await fs.writeFile(path.join(source, "original.bin"), "original");
  const selected = f.sources.select(1, [source]);
  const old = await selected,
    cp = f.sources.checkpoint(1, old.id);
  f.sources.reset(1);
  await fs.writeFile(path.join(source, "new.bin"), "outside original batch");
  const next = f.create(),
    choice = await next.sources.select(1, [source]),
    restored = next.sources.restore(
      1,
      choice.id,
      JSON.parse(JSON.stringify(cp)),
    );
  expect(restored.id).not.toBe(choice.id);
  expect(restored.entries.map((e: Entry) => e.id)).toEqual(
    old.entries.map((e: Entry) => e.id),
  );
  expect(restored.entries.some((e: Entry) => e.name === "new.bin")).toBe(false);
  const file = restored.entries.find((e: Entry) => e.kind === "file");
  expect(
    Buffer.from(
      await next.sources.chunk(1, restored.id, file.id, 0, 8),
    ).toString(),
  ).toBe("original");
  await expect(next.sources.check(1, choice.id, file.id)).rejects.toThrow(
    "UPLOAD_SOURCE_NOT_FOUND",
  );
  expect(() => next.sources.checkpoint(2, restored.id)).toThrow(
    "UPLOAD_SOURCE_NOT_FOUND",
  );
});
it("rejects a changed or unselected upload source and retains the newly selected capability on failure", async () => {
  const f = await fixture(),
    file = path.join(f.root, "source.bin");
  await fs.writeFile(file, "before");
  const old = await f.sources.select(1, [file]),
    cp = f.sources.checkpoint(1, old.id);
  f.sources.reset(1);
  await fs.writeFile(file, "changed source");
  const choice = await f.sources.select(1, [file]);
  expect(() => f.sources.restore(1, choice.id, cp)).toThrow(
    "UPLOAD_SOURCE_CHANGED",
  );
  expect((await f.sources.check(1, choice.id, choice.entries[0].id)).size).toBe(
    14,
  );
  expect(() => f.sources.restore(2, choice.id, cp)).toThrow(
    "UPLOAD_SOURCE_NOT_FOUND",
  );
  const bad = structuredClone(cp);
  bad.entries[0].view.parentId = bad.entries[0].view.id;
  expect(() => f.sources.restore(1, choice.id, bad)).toThrow(
    "UPLOAD_SOURCE_CHECKPOINT_INVALID",
  );
});
const mappings = (size = 4194304 + 3) => [
  { id: "dir", name: "目录", kind: "directory", size: 0 },
  { id: "done", parentId: "dir", name: "done.bin", kind: "file", size: 4 },
  { id: "part", parentId: "dir", name: "part.bin", kind: "file", size },
];
function confirm(
  targets: ReturnType<typeof DownloadDirectoryTargets>,
  p: { id: string; revision: string; entries: Entry[] },
) {
  return targets.confirm(
    1,
    p.id,
    p.revision,
    p.entries.map((e) => ({
      id: e.id,
      action:
        e.result?.state === "completed"
          ? "skip"
          : e.status === "new"
            ? "create"
            : e.status === "directory"
              ? "merge"
              : "overwrite",
    })),
  );
}
it("restores a completed file and paused member under a newly selected download root without replaying completed data", async () => {
  const f = await fixture(),
    chosen = await f.targets.choose(1, async () => f.root),
    p = await f.targets.preview(1, chosen.id, mappings());
  confirm(f.targets, p);
  await f.targets.directories(1, p.id);
  const done = Buffer.from("done"),
    partial = Buffer.alloc(4194304 + 3, 27),
    d = await f.targets.file(1, p.id, "done", spec(done));
  await f.sink.start(1, d.id, false);
  await f.sink.append(1, d.id, 0, done);
  await f.sink.finish(1, d.id);
  f.targets.complete(1, p.id, "done");
  const part = await f.targets.file(1, p.id, "part", spec(partial));
  await f.sink.start(1, part.id, false);
  await f.sink.append(1, part.id, 0, partial.subarray(0, 4194304));
  await f.sink.pause(1, part.id);
  await expect(f.targets.checkpoint(1, p.id)).rejects.toThrow(
    "DOWNLOAD_TREE_MEMBER_ACTIVE",
  );
  let member: unknown;
  await f.sink.suspend(1, part.id, async (cp: unknown) => {
    member = cp;
  });
  const cp = await f.targets.checkpoint(1, p.id);
  f.targets.forget(1, p.id);
  const next = f.create(),
    choice = await next.targets.choose(1, async () => f.root),
    before = await fs.stat(path.join(f.root, "目录/done.bin"));
  const r = await next.targets.restore(
    1,
    choice.id,
    JSON.parse(JSON.stringify(cp)),
  );
  expect(r.id).not.toBe(choice.id);
  expect(r.state).toBe("preview");
  expect(r.entries.find((e: Entry) => e.id === "done").result.state).toBe(
    "completed",
  );
  await expect(next.targets.directories(1, r.id)).rejects.toThrow(
    "DOWNLOAD_NOT_READY",
  );
  confirm(next.targets, r);
  await next.targets.directories(1, r.id);
  await expect(next.targets.file(1, r.id, "done", spec(done))).rejects.toThrow(
    "DOWNLOAD_NOT_READY",
  );
  const restored = await next.sink.restore(1, member, {
    authorize: () => {},
    overwrite: false,
    source: spec(partial),
  });
  await next.targets.attachRestored(1, r.id, "part", restored.id);
  await next.sink.resume(1, restored.id);
  await next.sink.append(1, restored.id, 4194304, partial.subarray(4194304));
  await next.sink.finish(1, restored.id);
  expect(next.targets.complete(1, r.id, "part").sha256).toBe(digest(partial));
  expect(
    (await fs.readFile(path.join(f.root, "目录/part.bin"))).equals(partial),
  ).toBe(true);
  const after = await fs.stat(path.join(f.root, "目录/done.bin"));
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeMs).toBe(before.mtimeMs);
});
it("rejects a modified completed download instead of restoring a false success receipt", async () => {
  const f = await fixture(),
    choice = await f.targets.choose(1, async () => f.root),
    p = await f.targets.preview(1, choice.id, [
      { id: "done", name: "done.bin", kind: "file", size: 4 },
    ]);
  confirm(f.targets, p);
  const bytes = Buffer.from("done"),
    file = await f.targets.file(1, p.id, "done", spec(bytes));
  await f.sink.start(1, file.id, false);
  await f.sink.append(1, file.id, 0, bytes);
  await f.sink.finish(1, file.id);
  f.targets.complete(1, p.id, "done");
  const cp = await f.targets.checkpoint(1, p.id);
  f.targets.forget(1, p.id);
  await fs.writeFile(path.join(f.root, "done.bin"), "evil");
  const next = f.create(),
    selected = await next.targets.choose(1, async () => f.root);
  await expect(next.targets.restore(1, selected.id, cp)).rejects.toThrow(
    "DOWNLOAD_RESULT_UNVERIFIED",
  );
  expect(next.targets.view(next.targets.owned(1, selected.id)).state).toBe(
    "preview",
  );
  expect((await fs.readFile(path.join(f.root, "done.bin"))).toString()).toBe(
    "evil",
  );
});
it("keeps an unknown local directory creation unknown after recovery and skip", async () => {
  const f = await fixture(),
    choice = await f.targets.choose(1, async () => f.root),
    p = await f.targets.preview(1, choice.id, [
      { id: "dir", name: "unknown", kind: "directory", size: 0 },
    ]);
  confirm(f.targets, p);
  const result = await f.targets.directories(1, p.id, {
    audit: async (type: string) => {
      if (type === "local_directory.entry-completed") throw Error("LOST_AUDIT");
    },
  });
  expect(result[0].state).toBe("unknown");
  const cp = await f.targets.checkpoint(1, p.id),
    next = f.create(),
    selected = await next.targets.choose(1, async () => f.root),
    r = await next.targets.restore(1, selected.id, cp);
  next.targets.confirm(1, r.id, r.revision, [{ id: "dir", action: "skip" }]);
  expect((await next.targets.directories(1, r.id))[0].state).toBe("unknown");
  expect(() => next.targets.forget(1, r.id)).toThrow("DOWNLOAD_NOT_READY");
});
it("rejects a different download root and aborts without consuming the user's selection", async () => {
  const f = await fixture(),
    choice = await f.targets.choose(1, async () => f.root),
    p = await f.targets.preview(1, choice.id, [
      { id: "dir", name: "empty", kind: "directory", size: 0 },
    ]);
  confirm(f.targets, p);
  await f.targets.directories(1, p.id);
  const cp = await f.targets.checkpoint(1, p.id),
    other = path.join(f.root, "other");
  await fs.mkdir(other);
  const next = f.create(),
    wrong = await next.targets.choose(1, async () => other);
  await expect(next.targets.restore(1, wrong.id, cp)).rejects.toThrow(
    "DOWNLOAD_TARGET_CHANGED",
  );
  const right = await next.targets.choose(1, async () => f.root);
  let calls = 0;
  await expect(
    next.targets.restore(1, right.id, cp, () => {
      if (++calls > 2) throw Error("REVOKED");
    }),
  ).rejects.toThrow("REVOKED");
  expect(next.targets.view(next.targets.owned(1, right.id)).entries).toEqual(
    [],
  );
});

it("hands paused download members and the directory checkpoint to one encrypted batch record", async () => {
  const f = await fixture(),
    { randomUUID, randomBytes } = await import("node:crypto"),
    { sealRecord, openRecord } =
      await import("../src/backend/privacy/encrypted-record-codec"),
    { DownloadBatchVault } = require("../electron/download-batch-vault.cjs");
  const key = randomBytes(32),
    vault = new DownloadBatchVault({
      root: path.join(f.root, "vault"),
      crypto: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => sealRecord(s, key, "TDB1", "test"),
        decryptString: (b: Buffer) => openRecord(b, key, "TDB1", "test"),
      },
    });
  const local = path.join(f.root, "destination");
  await fs.mkdir(local);
  const chosen = await f.targets.choose(1, async () => local),
    p = await f.targets.preview(1, chosen.id, [
      { id: "one", name: "one.bin", kind: "file", size: 4 },
      { id: "two", name: "two.bin", kind: "file", size: 4 },
    ]);
  confirm(f.targets, p);
  const bytes = Buffer.from("data"),
    ids: string[] = [];
  for (const entry of ["one", "two"]) {
    const v = await f.targets.file(1, p.id, entry, spec(bytes));
    await f.sink.start(1, v.id, false);
    await f.sink.append(1, v.id, 0, bytes);
    await f.sink.pause(1, v.id);
    ids.push(v.id);
  }
  await expect(
    f.sink.suspendBatch(1, ids, async () => {
      throw Error("DOWNLOAD_DISK_FULL");
    }),
  ).rejects.toThrow("DOWNLOAD_DISK_FULL");
  expect(f.sink.view(f.sink.owned(1, ids[0])).state).toBe("paused");
  expect(f.sink.view(f.sink.owned(1, ids[1])).state).toBe("paused");
  const id = randomUUID(),
    tree = {
      schemaVersion: 1,
      id: randomUUID(),
      userId: "owner",
      targetKey: "test-host",
      peer: "SHA256:test-peer",
      hostIdentity: "test",
      entries: ["one", "two"].map((entry) => ({
        view: {
          id: entry,
          kind: "file",
          name: entry + ".bin",
          path: "/" + entry + ".bin",
          size: 4,
        },
      })),
    };
  let stored: { id: string; claim: { id: string } } | undefined;
  await f.sink.suspendBatch(
    1,
    ids,
    async (
      parts: Array<{
        id: string;
        checkpoint: {
          id: string;
          spec: { sha256: string; hashes: string[] };
          writtenBytes: number;
        };
      }>,
    ) => {
      const target = await f.targets.checkpoint(
        1,
        p.id,
        undefined,
        new Set(ids),
      );
      const members = parts.map((part, i) => ({
        entryId: i ? "two" : "one",
        state: "paused",
        local: part.checkpoint,
        source: {
          schemaVersion: 1,
          id: part.id,
          userId: "owner",
          targetKey: tree.targetKey,
          peer: tree.peer,
          canonicalPath: i ? "/two.bin" : "/one.bin",
          stat: { size: 4 },
          sha256: part.checkpoint.spec.sha256,
          hashes: part.checkpoint.spec.hashes,
        },
      }));
      stored = await vault.create("owner", id, tree, target, members);
    },
  );
  expect(() => f.sink.owned(1, ids[0])).toThrow("DOWNLOAD_NOT_FOUND");
  f.targets.releaseRecovery(1, p.id);
  await vault.release("owner", id, stored!.claim.id);
  const dir = path.join(
      f.root,
      "vault",
      createHash("sha256").update("owner").digest("hex"),
    ),
    encrypted = await fs.readFile(path.join(dir, id + ".recovery"));
  expect(encrypted.includes(Buffer.from("one.bin"))).toBe(false);
  const other = new DownloadBatchVault({
    root: vault.root,
    crypto: vault.crypto,
  });
  const claims = await Promise.allSettled([
    vault.claim("owner", id),
    other.claim("owner", id),
  ]);
  expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(claims.filter((r) => r.status === "rejected")).toHaveLength(1);
  const row = (
    claims.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof vault.claim>>
    >
  ).value;
  expect(await vault.read("other-user", id)).toBeNull();
  vi.spyOn(vault.crypto, "isEncryptionAvailable").mockReturnValueOnce(false);
  await expect(
    vault.create("owner", randomUUID(), row.source, row.target, row.members),
  ).rejects.toThrow("DOWNLOAD_BATCH_ENCRYPTION_UNAVAILABLE");
  const next = f.create(),
    selected = await next.targets.choose(1, async () => local),
    target = await next.targets.restore(1, selected.id, row.target);
  confirm(next.targets, target);
  for (const m of row.members) {
    const v = await next.sink.restore(1, m.local, {
      authorize: () => {},
      overwrite: false,
      source: m.local.spec,
    });
    await next.targets.attachRestored(1, target.id, m.entryId, v.id);
    await next.sink.resume(1, v.id);
    await next.sink.finish(1, v.id);
    expect(next.targets.complete(1, target.id, m.entryId).sha256).toBe(
      digest(bytes),
    );
  }
  expect((await fs.readFile(path.join(local, "one.bin"))).equals(bytes)).toBe(
    true,
  );
  expect((await fs.readFile(path.join(local, "two.bin"))).equals(bytes)).toBe(
    true,
  );
});
it("preserves confirmed native batch progress on revocation instead of deleting its partial file", async () => {
  const f = await fixture(),
    bytes = Buffer.alloc(4194304 + 7, 9),
    v = await f.sink.choose(1, spec(bytes), async () =>
      path.join(f.root, "partial.bin"),
    );
  await f.sink.start(1, v.id, false);
  await f.sink.append(1, v.id, 0, bytes.subarray(0, 4194304));
  const result = await f.sink.preserveBatch(1, [v.id]);
  expect(result[0].checkpoint.writtenBytes).toBe(4194304);
  expect((await fs.stat(result[0].checkpoint.stagePath)).size).toBe(4194304);
  expect(() => f.sink.owned(1, v.id)).toThrow("DOWNLOAD_NOT_FOUND");
  const next = f.create(),
    restored = await next.sink.restore(1, result[0].checkpoint, {
      authorize: () => {},
      overwrite: false,
      source: spec(bytes),
    });
  expect(restored.state).toBe("paused");
  await next.sink.resume(1, restored.id);
  await next.sink.append(1, restored.id, 4194304, bytes.subarray(4194304));
  await next.sink.finish(1, restored.id);
  expect(
    (await fs.readFile(path.join(f.root, "partial.bin"))).equals(bytes),
  ).toBe(true);
});
