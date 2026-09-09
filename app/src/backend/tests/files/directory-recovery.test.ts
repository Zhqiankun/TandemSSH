import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService, type UploadPorts } from "../../files/upload-service";
import { DownloadService } from "../../files/download-service";
import { UploadTreeService } from "../../files/upload-tree-service";
import { DownloadTreeService } from "../../files/download-tree-service";
import { FilePathLocks } from "../../files/path-locks";
import type {
  UploadTreeMapping,
  UploadTreePreview,
} from "../../../types/upload-tree";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
const manifest = (bytes: Buffer) => ({
  name: "source.bin",
  size: bytes.length,
  lastModified: 100,
  hashes: Array.from({ length: Math.ceil(bytes.length / 4194304) }, (_, i) =>
    createHash("sha256")
      .update(bytes.subarray(i * 4194304, (i + 1) * 4194304))
      .digest("hex"),
  ),
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  await remote.mkdir("/dest");
  await remote.mkdir("/source/empty");
  await remote.write("/source/文件.txt", "source");
  let io = remote.io,
    peer = remote.peerKey(),
    retained = 0,
    writes = 0;
  const ports: UploadPorts = {
    locks: new FilePathLocks(),
    audit: vi.fn(async () => {}),
    target: async (user, session) => {
      if (user !== actor.userId || !["old", "new"].includes(session))
        throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        key: "fixture",
        connection: session,
        acceptedHostKey: peer,
        hostScope: { userId: user, identity: "fixture" },
        io,
        check: () => {},
        retain: () => {
          retained++;
          return () => {
            retained--;
          };
        },
      };
    },
    beginWrite: () => {
      writes++;
      return () => {};
    },
  };
  const create = () => {
    const uploads = new UploadService(ports),
      uploadTrees = new UploadTreeService(ports, uploads),
      downloads = new DownloadService(ports),
      downloadTrees = new DownloadTreeService(ports, downloads);
    const dispose = () => {
      uploadTrees.dispose();
      uploads.dispose();
      downloadTrees.dispose();
      downloads.dispose();
    };
    cleanup.push(dispose);
    return { uploads, uploadTrees, downloads, downloadTrees, dispose };
  };
  const first = create();
  return {
    remote,
    ports,
    first,
    create,
    held: () => retained,
    writes: () => writes,
    changePeer: () => {
      peer = "SHA256:changed";
    },
    reconnect: async () => {
      const c = await remote.reconnect();
      io = c.io;
    },
    activeIo: () => io,
  };
}
const mapping = (size = 4194304 + 29): UploadTreeMapping[] => [
  { id: "dir", name: "应用", kind: "directory", size: 0, lastModified: 0 },
  {
    id: "empty",
    parentId: "dir",
    name: "空目录",
    kind: "directory",
    size: 0,
    lastModified: 0,
  },
  {
    id: "file",
    parentId: "dir",
    name: "数据.bin",
    kind: "file",
    size,
    lastModified: 100,
  },
];
async function confirm(trees: UploadTreeService, preview: UploadTreePreview) {
  return trees.confirm(
    actor,
    preview.id,
    preview.revision,
    preview.entries.map((e) => ({
      id: e.id,
      action:
        e.status === "new"
          ? "create"
          : e.status === "directory"
            ? "merge"
            : "overwrite",
    })),
  );
}
it("restores created directories on a new SSH connection and continues a paused member without recreating directories", async () => {
  const f = await fixture(),
    old = f.first,
    bytes = Buffer.alloc(4194304 + 29, 31);
  const p = await old.uploadTrees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries: mapping(),
  });
  await confirm(old.uploadTrees, p);
  await old.uploadTrees.directories(actor, p.id);
  const member = await old.uploadTrees.prepareEntry(
    actor,
    p.id,
    "file",
    "old",
    randomUUID(),
    manifest(bytes),
  );
  await old.uploads.start(actor, member.id, { overwrite: false });
  await old.uploads.chunk(actor, member.id, 0, bytes.subarray(0, 4194304));
  await old.uploads.pause(actor, member.id);
  const fileCheckpoint = old.uploads.checkpoint(actor, member.id),
    treeCheckpoint = old.uploadTrees.checkpoint(actor, p.id);
  old.dispose();
  await f.reconnect();
  const next = f.create(),
    before = f.writes(),
    mkdir = vi.spyOn(f.activeIo(), "mkdir");
  const restored = await next.uploadTrees.restore(
    actor,
    JSON.parse(JSON.stringify(treeCheckpoint)),
    "new",
  );
  expect(restored.id).not.toBe(p.id);
  expect(restored.revision).not.toBe(p.revision);
  expect(restored.state).toBe("preview");
  expect(restored.entries.every((e) => !e.action)).toBe(true);
  expect(
    restored.entries
      .filter((e) => e.kind === "directory")
      .map((e) => e.result?.state),
  ).toEqual(["created", "created"]);
  expect(f.writes()).toBe(before);
  expect(mkdir).not.toHaveBeenCalled();
  await expect(
    next.uploadTrees.directories(actor, restored.id),
  ).rejects.toThrow("UPLOAD_STATE_INVALID");
  await confirm(next.uploadTrees, restored);
  await next.uploadTrees.directories(actor, restored.id);
  expect(mkdir).not.toHaveBeenCalled();
  const r = await next.uploads.restore(
    actor,
    fileCheckpoint,
    "new",
    manifest(bytes),
    false,
  );
  expect(r.state).toBe("paused");
  await next.uploads.resume(actor, r.id, "new");
  await next.uploads.chunk(actor, r.id, 4194304, bytes.subarray(4194304));
  expect((await next.uploads.finish(actor, r.id)).state).toBe("completed");
  expect((await f.remote.read("/dest/应用/数据.bin")).equals(bytes)).toBe(true);
  expect(f.held()).toBe(0);
});
it("keeps unknown directory creation unknown after restoring and choosing skip", async () => {
  const f = await fixture(),
    trees = f.first.uploadTrees;
  const p = await trees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries: mapping().slice(0, 1),
  });
  await confirm(trees, p);
  const mkdir = f.remote.io.mkdir!.bind(f.remote.io);
  vi.spyOn(f.remote.io, "mkdir").mockImplementationOnce(async (...args) => {
    await mkdir(...args);
    throw Error("LOST_REPLY");
  });
  expect((await trees.directories(actor, p.id))[0].state).toBe("unknown");
  const cp = trees.checkpoint(actor, p.id);
  f.first.dispose();
  const next = f.create();
  const r = await next.uploadTrees.restore(actor, cp, "new");
  await next.uploadTrees.confirm(actor, r.id, r.revision, [
    { id: "dir", action: "skip" },
  ]);
  expect((await next.uploadTrees.directories(actor, r.id))[0].state).toBe(
    "unknown",
  );
  expect(() => next.uploadTrees.forget(actor, r.id)).toThrow(
    "UPLOAD_CLEANUP_PENDING",
  );
});
it("preserves the original overwrite baseline after restore", async () => {
  const f = await fixture(),
    trees = f.first.uploadTrees;
  await f.remote.write("/dest/existing.txt", "old");
  const p = await trees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries: [
      {
        id: "file",
        name: "existing.txt",
        kind: "file",
        size: 4,
        lastModified: 100,
      },
    ],
  });
  await confirm(trees, p);
  const cp = trees.checkpoint(actor, p.id);
  f.first.dispose();
  await f.remote.write("/dest/existing.txt", "externally changed");
  const next = f.create(),
    r = await next.uploadTrees.restore(actor, cp, "new");
  await confirm(next.uploadTrees, r);
  await expect(
    next.uploadTrees.prepareEntry(
      actor,
      r.id,
      "file",
      "new",
      randomUUID(),
      manifest(Buffer.from("next")),
    ),
  ).rejects.toThrow();
  expect((await f.remote.read("/dest/existing.txt")).toString()).toBe(
    "externally changed",
  );
});
it("rejects upload ownership, peer, malformed parent and redirected root metadata", async () => {
  const f = await fixture(),
    trees = f.first.uploadTrees,
    p = await trees.preview(actor, {
      sessionId: "old",
      path: "/dest",
      entries: mapping(),
    });
  await confirm(trees, p);
  const cp = trees.checkpoint(actor, p.id);
  await expect(trees.restore({ userId: "other" }, cp, "new")).rejects.toThrow(
    "UPLOAD_NOT_FOUND",
  );
  const bad = structuredClone(cp);
  bad.entries[0].view.parentId = "dir";
  await expect(trees.restore(actor, bad, "new")).rejects.toThrow();
  const target = f.ports.target;
  f.ports.target = async (...args) => {
    const t = await target(...args);
    return {
      ...t,
      io: { ...t.io, resolve: async () => "/changed" } as typeof t.io,
    };
  };
  await expect(trees.restore(actor, cp, "new")).rejects.toThrow(
    "FILE_TARGET_CHANGED",
  );
  f.ports.target = target;
  f.changePeer();
  await expect(trees.restore(actor, cp, "new")).rejects.toThrow(
    "UPLOAD_HOST_IDENTITY_CHANGED",
  );
  expect(f.held()).toBe(0);
});
it("does not resurrect an upload tree when disposed during the restore audit", async () => {
  const f = await fixture(),
    p = await f.first.uploadTrees.preview(actor, {
      sessionId: "old",
      path: "/dest",
      entries: mapping(),
    });
  await confirm(f.first.uploadTrees, p);
  const cp = f.first.uploadTrees.checkpoint(actor, p.id),
    next = f.create();
  vi.mocked(f.ports.audit).mockImplementationOnce(async () => {
    next.uploadTrees.dispose();
  });
  await expect(next.uploadTrees.restore(actor, cp, "new")).rejects.toThrow(
    "UPLOAD_CANCELLED",
  );
  expect(f.held()).toBe(0);
});
it("restores a fixed download collection on a new connection without adopting new source entries", async () => {
  const f = await fixture(),
    p = await f.first.downloadTrees.scan(actor, {
      sessionId: "old",
      paths: ["/source"],
    });
  const cp = f.first.downloadTrees.checkpoint(actor, p.id);
  f.first.dispose();
  await f.remote.write("/source/new.txt", "not in the old batch");
  await f.reconnect();
  const next = f.create(),
    reads = f.remote.directoryReads(),
    r = await next.downloadTrees.restore(
      actor,
      JSON.parse(JSON.stringify(cp)),
      "new",
    );
  expect(r.id).not.toBe(p.id);
  expect(r.entries).toEqual(p.entries);
  expect(r.files).toBe(1);
  expect(r.directories).toBe(2);
  expect(f.remote.directoryReads()).toBe(reads);
  const e = r.entries.find((e) => e.kind === "file")!,
    source = await next.downloadTrees.prepareEntry(
      actor,
      r.id,
      e.id,
      randomUUID(),
      "new",
    );
  expect(source.sha256).toBe(
    createHash("sha256").update("source").digest("hex"),
  );
  expect(f.writes()).toBe(0);
  expect(f.held()).toBe(1); // A prepared source retains its SSH connection until explicitly released.
  await next.downloads.cancel(actor, source.id);
  expect(f.held()).toBe(0);
});
it("rejects changed download sources at restore and again at member preparation", async () => {
  const f = await fixture(),
    p = await f.first.downloadTrees.scan(actor, {
      sessionId: "old",
      paths: ["/source"],
    }),
    cp = f.first.downloadTrees.checkpoint(actor, p.id);
  const next = f.create(),
    r = await next.downloadTrees.restore(actor, cp, "new");
  await f.remote.write("/source/文件.txt", "changed size");
  await expect(next.downloadTrees.restore(actor, cp, "new")).rejects.toThrow(
    "DOWNLOAD_SOURCE_CHANGED",
  );
  await expect(
    next.downloadTrees.prepareEntry(
      actor,
      r.id,
      r.entries.find((e) => e.kind === "file")!.id,
      randomUUID(),
      "new",
    ),
  ).rejects.toThrow("DOWNLOAD_SOURCE_CHANGED");
});
it("binds directory-only downloads to user and accepted peer and rejects invalid hierarchy", async () => {
  const f = await fixture(),
    p = await f.first.downloadTrees.scan(actor, {
      sessionId: "old",
      paths: ["/source/empty"],
    }),
    cp = f.first.downloadTrees.checkpoint(actor, p.id);
  await expect(
    f.first.downloadTrees.restore({ userId: "other" }, cp, "new"),
  ).rejects.toThrow("DOWNLOAD_NOT_FOUND");
  const bad = structuredClone(cp);
  bad.entries[0].view.parentId = bad.entries[0].view.id;
  await expect(
    f.first.downloadTrees.restore(actor, bad, "new"),
  ).rejects.toThrow();
  f.changePeer();
  await expect(f.first.downloadTrees.restore(actor, cp, "new")).rejects.toThrow(
    "DOWNLOAD_HOST_IDENTITY_CHANGED",
  );
});
it("applies download preview capacity and abort checks to recovery", async () => {
  const f = await fixture(),
    p = await f.first.downloadTrees.scan(actor, {
      sessionId: "old",
      paths: ["/source"],
    }),
    cp = f.first.downloadTrees.checkpoint(actor, p.id);
  f.first.dispose();
  const next = f.create();
  const stop = new AbortController();
  vi.mocked(f.ports.audit).mockImplementationOnce(async () => {
    stop.abort();
  });
  await expect(
    next.downloadTrees.restore({ ...actor, signal: stop.signal }, cp, "new"),
  ).rejects.toThrow("DOWNLOAD_CANCELLED");
  for (let i = 0; i < 4; i++)
    await next.downloadTrees.restore(actor, cp, "new");
  await expect(next.downloadTrees.restore(actor, cp, "new")).rejects.toThrow(
    "DOWNLOAD_TREE_LIMIT",
  );
  expect(f.held()).toBe(0);
});

it("records verified upload receipts before cleanup and preserves them across directory restore", async () => {
  const f = await fixture(),
    bytes = Buffer.from("done"),
    trees = f.first.uploadTrees;
  const p = await trees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries: mapping(4),
  });
  await confirm(trees, p);
  await trees.directories(actor, p.id);
  const file = await trees.prepareEntry(
    actor,
    p.id,
    "file",
    "old",
    randomUUID(),
    manifest(bytes),
  );
  await expect(
    trees.completeEntry(actor, p.id, "file", file.id),
  ).rejects.toThrow("UPLOAD_RESULT_UNVERIFIED");
  await f.first.uploads.start(actor, file.id, { overwrite: false });
  await f.first.uploads.chunk(actor, file.id, 0, bytes);
  await f.first.uploads.finish(actor, file.id);
  const receipt = await trees.completeEntry(actor, p.id, "file", file.id);
  const unrelated = await f.first.uploads.prepare(actor, {
    sessionId: "old",
    path: "/dest/unrelated.bin",
    requestId: randomUUID(),
    manifest: manifest(bytes),
  });
  await f.first.uploads.start(actor, unrelated.id, { overwrite: false });
  await f.first.uploads.chunk(actor, unrelated.id, 0, bytes);
  await f.first.uploads.finish(actor, unrelated.id);
  const otherTree = await trees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries: [
      {
        id: "file",
        name: "unrelated.bin",
        kind: "file",
        size: 4,
        lastModified: 100,
      },
    ],
  });
  await confirm(trees, otherTree);
  await expect(
    trees.completeEntry(actor, otherTree.id, "file", unrelated.id),
  ).rejects.toThrow("UPLOAD_RESULT_UNVERIFIED");
  expect(receipt).toMatchObject({
    state: "completed",
    bytes: 4,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  f.first.uploads.forget(actor, file.id);
  expect(await trees.completeEntry(actor, p.id, "file", file.id)).toEqual(
    receipt,
  );
  const cp = trees.checkpoint(actor, p.id);
  f.first.dispose();
  await f.reconnect();
  const next = f.create(),
    r = await next.uploadTrees.restore(actor, cp, "new");
  expect(r.entries.find((e) => e.id === "file")?.fileResult).toEqual(receipt);
  await confirm(next.uploadTrees, r);
  expect(
    next.uploadTrees.get(actor, r.id).entries.find((e) => e.id === "file")
      ?.action,
  ).toBe("skip");
  await expect(
    next.uploadTrees.prepareEntry(
      actor,
      r.id,
      "file",
      "new",
      randomUUID(),
      manifest(bytes),
    ),
  ).rejects.toThrow("UPLOAD_TREE_ENTRY_UNAVAILABLE");
  await f.remote.write("/dest/应用/数据.bin", "evil");
  await expect(next.uploadTrees.restore(actor, cp, "new")).rejects.toThrow(
    "UPLOAD_RESULT_UNVERIFIED",
  );
});
it("retains the completed upload after receipt audit failure and retries metadata without another write", async () => {
  const f = await fixture(),
    bytes = Buffer.from("done"),
    trees = f.first.uploadTrees,
    p = await trees.preview(actor, {
      sessionId: "old",
      path: "/dest",
      entries: mapping(4),
    });
  await confirm(trees, p);
  await trees.directories(actor, p.id);
  const file = await trees.prepareEntry(
    actor,
    p.id,
    "file",
    "old",
    randomUUID(),
    manifest(bytes),
  );
  await f.first.uploads.start(actor, file.id, { overwrite: false });
  await f.first.uploads.chunk(actor, file.id, 0, bytes);
  await f.first.uploads.finish(actor, file.id);
  const before = f.remote.writes();
  vi.mocked(f.ports.audit).mockRejectedValueOnce(Error("AUDIT_UNAVAILABLE"));
  await expect(
    trees.completeEntry(actor, p.id, "file", file.id),
  ).rejects.toThrow("AUDIT_UNAVAILABLE");
  expect(
    trees.get(actor, p.id).entries.find((e) => e.id === "file")?.fileResult,
  ).toBeUndefined();
  expect(f.first.uploads.get(actor, file.id).state).toBe("completed");
  await trees.completeEntry(actor, p.id, "file", file.id);
  expect(f.remote.writes()).toBe(before);
});
it("does not serialize unrelated uploads behind a pending receipt and rejects cross-user or wrong-entry completion", async () => {
  const f = await fixture(),
    bytes = Buffer.from("done"),
    trees = f.first.uploadTrees,
    p = await trees.preview(actor, {
      sessionId: "old",
      path: "/dest",
      entries: [
        ...mapping(4),
        {
          id: "second",
          parentId: "dir",
          name: "other.bin",
          kind: "file",
          size: 4,
          lastModified: 100,
        },
      ],
    });
  await confirm(trees, p);
  await trees.directories(actor, p.id);
  const file = await trees.prepareEntry(
    actor,
    p.id,
    "file",
    "old",
    randomUUID(),
    manifest(bytes),
  );
  await f.first.uploads.start(actor, file.id, { overwrite: false });
  await f.first.uploads.chunk(actor, file.id, 0, bytes);
  await f.first.uploads.finish(actor, file.id);
  await expect(
    trees.completeEntry({ userId: "other" }, p.id, "file", file.id),
  ).rejects.toThrow("UPLOAD_NOT_FOUND");
  await expect(
    trees.completeEntry(actor, p.id, "second", file.id),
  ).rejects.toThrow("UPLOAD_RESULT_UNVERIFIED");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.mocked(f.ports.audit).mockImplementationOnce(async () => gate);
  const save = trees.completeEntry(actor, p.id, "file", file.id),
    same = trees.completeEntry(actor, p.id, "file", file.id);
  try {
    expect(() => trees.checkpoint(actor, p.id)).toThrow("UPLOAD_STATE_INVALID");
    expect(
      (
        await trees.prepareEntry(
          actor,
          p.id,
          "second",
          "old",
          randomUUID(),
          manifest(bytes),
        )
      ).state,
    ).toBe("preview");
  } finally {
    release();
  }
  expect(await same).toEqual(await save);
});

it("persists a directory and paused/pending upload members together before releasing any runtime", async () => {
  const f = await fixture(),
    old = f.first,
    bytes = Buffer.alloc(4194304 + 7, 41),
    entries = [
      ...mapping(bytes.length),
      {
        id: "second",
        parentId: "dir",
        name: "pending.bin",
        kind: "file" as const,
        size: 4,
        lastModified: 100,
      },
    ];
  const p = await old.uploadTrees.preview(actor, {
    sessionId: "old",
    path: "/dest",
    entries,
  });
  await confirm(old.uploadTrees, p);
  await old.uploadTrees.directories(actor, p.id);
  const partial = await old.uploadTrees.prepareEntry(
      actor,
      p.id,
      "file",
      "old",
      randomUUID(),
      manifest(bytes),
    ),
    pending = await old.uploadTrees.prepareEntry(
      actor,
      p.id,
      "second",
      "old",
      randomUUID(),
      manifest(Buffer.from("next")),
    );
  await old.uploads.start(actor, partial.id, { overwrite: false });
  await old.uploads.chunk(actor, partial.id, 0, bytes.subarray(0, 4194304));
  await old.uploads.pause(actor, partial.id);
  const snapshots: Array<
    Parameters<Parameters<UploadService["suspendBatch"]>[2]>[0]
  > = [];
  await expect(
    old.uploadTrees.suspend(actor, p.id, (tree) =>
      old.uploads
        .suspendBatch(actor, [partial.id, pending.id], async (members) => {
          snapshots.push(members);
          expect(tree.id).toBe(p.id);
          expect(() => old.uploads.cancel(actor, partial.id, true)).toThrow(
            "UPLOAD_BUSY",
          );
          throw Error("DISK_FULL");
        })
        .then(() => {}),
    ),
  ).rejects.toThrow("DISK_FULL");
  expect(old.uploadTrees.get(actor, p.id).state).toBe("confirmed");
  expect(old.uploads.get(actor, partial.id).state).toBe("paused");
  expect(old.uploads.get(actor, pending.id).state).toBe("preview");
  const { sealRecord, openRecord } =
      await import("../../privacy/encrypted-record-codec"),
    key = Buffer.alloc(32, 73),
    file = f.remote.localPathForTest("/owned-checkpoint.bin");
  const fs = await import("node:fs/promises");
  await old.uploadTrees.suspend(actor, p.id, (tree) =>
    old.uploads
      .suspendBatch(actor, [partial.id, pending.id], async (members) => {
        const encrypted = sealRecord(
          JSON.stringify({ tree, members }),
          key,
          "TUB1",
          p.id,
        );
        expect(encrypted.includes(Buffer.from("/dest"))).toBe(false);
        const handle = await fs.open(file, "wx");
        try {
          await handle.writeFile(encrypted);
          await handle.sync();
        } finally {
          await handle.close();
        }
      })
      .then(() => {}),
  );
  expect(() => old.uploadTrees.get(actor, p.id)).toThrow("UPLOAD_NOT_FOUND");
  expect(() => old.uploads.get(actor, partial.id)).toThrow("UPLOAD_NOT_FOUND");
  expect(() => old.uploads.get(actor, pending.id)).toThrow("UPLOAD_NOT_FOUND");
  const recovered = JSON.parse(
    openRecord(await fs.readFile(file), key, "TUB1", p.id),
  );
  expect(recovered.members.map((m: { state: string }) => m.state)).toEqual([
    "paused",
    "pending",
  ]);
  old.dispose();
  await f.reconnect();
  const next = f.create(),
    r = await next.uploadTrees.restore(actor, recovered.tree, "new");
  await confirm(next.uploadTrees, r);
  await next.uploadTrees.directories(actor, r.id);
  const restored = await next.uploads.restore(
    actor,
    recovered.members[0].checkpoint,
    "new",
    manifest(bytes),
    false,
  );
  await next.uploads.resume(actor, restored.id, "new");
  await next.uploads.chunk(
    actor,
    restored.id,
    4194304,
    bytes.subarray(4194304),
  );
  expect((await next.uploads.finish(actor, restored.id)).state).toBe(
    "completed",
  );
  expect(
    (await next.uploadTrees.completeEntry(actor, r.id, "file", restored.id))
      .state,
  ).toBe("completed");
  const second = await next.uploadTrees.prepareEntry(
    actor,
    r.id,
    "second",
    "new",
    randomUUID(),
    manifest(Buffer.from("next")),
  );
  await next.uploads.start(actor, second.id, { overwrite: false });
  await next.uploads.chunk(actor, second.id, 0, Buffer.from("next"));
  await next.uploads.finish(actor, second.id);
  expect((await f.remote.read("/dest/应用/数据.bin")).equals(bytes)).toBe(true);
  expect((await f.remote.read("/dest/应用/pending.bin")).toString()).toBe(
    "next",
  );
  expect(snapshots).toHaveLength(1);
});
it("exports uncertain members as unknown and never retries their commit during batch handoff", async () => {
  const f = await fixture(),
    bytes = Buffer.from("done"),
    p = await f.first.uploads.prepare(actor, {
      sessionId: "old",
      path: "/dest/uncertain.bin",
      requestId: randomUUID(),
      manifest: manifest(bytes),
    });
  await f.first.uploads.start(actor, p.id, { overwrite: false });
  await f.first.uploads.chunk(actor, p.id, 0, bytes);
  const replace = f.remote.io.replace.bind(f.remote.io);
  vi.spyOn(f.remote.io, "replace").mockImplementationOnce(async (...args) => {
    await replace(...args);
    throw Error("LOST_REPLY");
  });
  expect((await f.first.uploads.finish(actor, p.id)).state).toBe("unknown");
  const renames = f.remote.renames(),
    persist = vi.fn(
      async (
        members: Parameters<Parameters<UploadService["suspendBatch"]>[2]>[0],
      ) => {
        expect(members[0].state).toBe("unknown");
        expect(members[0].checkpoint?.canonicalPath).toBe(
          "/dest/uncertain.bin",
        );
      },
    );
  await f.first.uploads.suspendBatch(actor, [p.id], persist);
  expect(persist).toHaveBeenCalledOnce();
  expect(f.remote.renames()).toBe(renames);
  expect((await f.remote.read("/dest/uncertain.bin")).equals(bytes)).toBe(true);
});
it("rejects a directory snapshot while a member prepare request is still in flight", async () => {
  const f = await fixture(),
    p = await f.first.uploadTrees.preview(actor, {
      sessionId: "old",
      path: "/dest",
      entries: mapping(4),
    });
  await confirm(f.first.uploadTrees, p);
  await f.first.uploadTrees.directories(actor, p.id);
  const original = f.ports.target;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  f.ports.target = async (...args) => {
    await gate;
    return original(...args);
  };
  const prepare = f.first.uploadTrees.prepareEntry(
    actor,
    p.id,
    "file",
    "old",
    randomUUID(),
    manifest(Buffer.from("data")),
  );
  try {
    expect(() => f.first.uploadTrees.checkpoint(actor, p.id)).toThrow(
      "UPLOAD_STATE_INVALID",
    );
  } finally {
    release();
  }
  await prepare;
  expect(f.first.uploadTrees.checkpoint(actor, p.id).id).toBe(p.id);
});
