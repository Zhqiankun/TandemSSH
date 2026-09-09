import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService } from "../../files/upload-service";
import { UploadRecoveryStore } from "../../files/upload-recovery-store";
import { FilePathLocks } from "../../files/path-locks";
import { UPLOAD_CHUNK_BYTES } from "../../../types/file-upload";
const closes: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
const manifest = (bytes: Buffer) => ({
  name: "source.bin",
  size: bytes.length,
  lastModified: 100,
  hashes: Array.from(
    { length: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) },
    (_, i) =>
      createHash("sha256")
        .update(
          bytes.subarray(i * UPLOAD_CHUNK_BYTES, (i + 1) * UPLOAD_CHUNK_BYTES),
        )
        .digest("hex"),
  ),
});
async function fixture(
  bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 43, 63),
  existing?: string,
) {
  const remote = await fileSftpFixture();
  closes.push(() => remote.close());
  if (existing !== undefined) await remote.write("/target.bin", existing);
  let key = remote.peerKey(),
    connection = "old",
    auto = false,
    takeovers = 0,
    writes = 0;
  const audit = vi.fn(async () => {});
  const factory = () => {
    const service = new UploadService({
      locks: new FilePathLocks(),
      target: async (user) => {
        if (user !== "owner") throw Error("FILE_SESSION_UNAVAILABLE");
        return {
          io: remote.io,
          key: "target-key",
          acceptedHostKey: key,
          connection,
          hostScope: { userId: user, identity: "test@server" },
          check: () => {},
        };
      },
      beginWrite: (_user, _target, takeover) => {
        if (auto && !takeover) throw Error("FILE_AUTOMATION_ACTIVE");
        if (auto) {
          auto = false;
          takeovers++;
        }
        writes++;
        return () => {};
      },
      audit,
    });
    closes.push(() => service.dispose());
    return service;
  };
  const service = factory(),
    m = manifest(bytes),
    view = await service.prepare(actor, {
      sessionId: "session",
      requestId: randomUUID(),
      path: "/target.bin",
      manifest: m,
    });
  await service.start(actor, view.id, { overwrite: existing !== undefined });
  if (bytes.length)
    await service.chunk(
      actor,
      view.id,
      0,
      bytes.subarray(0, Math.min(bytes.length, UPLOAD_CHUNK_BYTES)),
    );
  await service.pause(actor, view.id);
  return {
    remote,
    bytes,
    manifest: m,
    service,
    view,
    factory,
    audit,
    changeKey: (next: string) => {
      key = next;
    },
    reconnect: () => {
      connection = "new";
    },
    automation: () => {
      auto = true;
    },
    takeovers: () => takeovers,
    writes: () => writes,
  };
}
it("restores a new paused task without writes, then requires takeover to continue", async () => {
  const f = await fixture(),
    cp = f.service.checkpoint(actor, f.view.id);
  await f.service.suspend(actor, f.view.id, async () => {});
  f.service.dispose();
  f.reconnect();
  f.automation();
  const next = f.factory(),
    before = f.remote.writes(),
    restored = await next.restore(
      actor,
      JSON.parse(JSON.stringify(cp)),
      "new",
      f.manifest,
    );
  expect(restored.id).not.toBe(cp.id);
  expect(restored.state).toBe("paused");
  expect(f.remote.writes()).toBe(before);
  expect(f.takeovers()).toBe(0);
  expect((await next.resume(actor, restored.id, "new")).error).toBe(
    "FILE_AUTOMATION_ACTIVE",
  );
  expect((await next.resume(actor, restored.id, "new", true)).state).toBe(
    "uploading",
  );
  expect(f.takeovers()).toBe(1);
  await next.chunk(
    actor,
    restored.id,
    UPLOAD_CHUNK_BYTES,
    f.bytes.subarray(UPLOAD_CHUNK_BYTES),
  );
  expect((await next.finish(actor, restored.id)).state).toBe("completed");
  expect((await f.remote.read("/target.bin")).equals(f.bytes)).toBe(true);
}, 15000);
it("refuses foreign identity, changed host key, different source and repeated restore", async () => {
  const f = await fixture(),
    cp = f.service.checkpoint(actor, f.view.id);
  await expect(f.service.restore(actor, cp, "new", f.manifest)).rejects.toThrow(
    "UPLOAD_RECOVERY_IN_USE",
  );
  await f.service.suspend(actor, f.view.id, async () => {});
  const next = f.factory();
  await expect(
    next.restore({ userId: "other" }, cp, "new", f.manifest),
  ).rejects.toThrow("UPLOAD_NOT_FOUND");
  await expect(
    next.restore(actor, cp, "new", { ...f.manifest, lastModified: 101 }),
  ).rejects.toThrow("UPLOAD_SOURCE_CHANGED");
  f.changeKey("SHA256:other");
  await expect(next.restore(actor, cp, "new", f.manifest)).rejects.toThrow(
    "UPLOAD_HOST_IDENTITY_CHANGED",
  );
  f.changeKey(cp.acceptedHostKey);
  const results = await Promise.allSettled([
    next.restore(actor, cp, "new", f.manifest),
    next.restore(actor, cp, "new", f.manifest),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("requires new overwrite consent and rejects a changed target or confirmed prefix", async () => {
  const f = await fixture(undefined, "old"),
    cp = f.service.checkpoint(actor, f.view.id);
  await f.service.suspend(actor, f.view.id, async () => {});
  const next = f.factory();
  await expect(next.restore(actor, cp, "new", f.manifest)).rejects.toThrow(
    "UPLOAD_OVERWRITE_REQUIRED",
  );
  await f.remote.write("/target.bin", "changed");
  await expect(
    next.restore(actor, cp, "new", f.manifest, true),
  ).rejects.toThrow("FILE_CONFLICT");
  expect((await f.remote.read("/target.bin")).toString()).toBe("changed");
  const fresh = await fixture(),
    checkpoint = fresh.service.checkpoint(actor, fresh.view.id);
  await fresh.service.suspend(actor, fresh.view.id, async () => {});
  const file = await fs.open(
    fresh.remote.localPathForTest(checkpoint.temporaryPath),
    "r+",
  );
  await file.write(Buffer.from([0]), 0, 1, 0);
  await file.close();
  await expect(
    fresh.factory().restore(actor, checkpoint, "new", fresh.manifest),
  ).rejects.toThrow("UPLOAD_CHECKPOINT_CHANGED");
});
it("keeps unconfirmed tails during verification and truncates only on explicit resume", async () => {
  const f = await fixture(),
    cp = f.service.checkpoint(actor, f.view.id);
  await f.service.suspend(actor, f.view.id, async () => {});
  await fs.appendFile(f.remote.localPathForTest(cp.temporaryPath), "tail");
  const next = f.factory(),
    restored = await next.restore(actor, cp, "new", f.manifest);
  expect((await f.remote.read(cp.temporaryPath)).length).toBe(
    UPLOAD_CHUNK_BYTES + 4,
  );
  await next.resume(actor, restored.id, "new");
  expect((await f.remote.read(cp.temporaryPath)).length).toBe(
    UPLOAD_CHUNK_BYTES,
  );
});
it("retains a paused task after failed persistence and blocks mutations during handoff", async () => {
  const f = await fixture(Buffer.from("short"));
  await expect(
    f.service.suspend(actor, f.view.id, async () => {
      throw Error("disk full");
    }),
  ).rejects.toThrow("disk full");
  expect(f.service.get(actor, f.view.id).state).toBe("paused");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const saving = f.service.suspend(actor, f.view.id, () => gate);
  expect(() => f.service.cancel(actor, f.view.id, true)).toThrow("UPLOAD_BUSY");
  release();
  await saving;
  expect(() => f.service.get(actor, f.view.id)).toThrow("UPLOAD_NOT_FOUND");
});
it("does not resurrect a recovery after service disposal", async () => {
  const f = await fixture(Buffer.from("small")),
    cp = f.service.checkpoint(actor, f.view.id);
  await f.service.suspend(actor, f.view.id, async () => {});
  const next = f.factory();
  next.dispose();
  await expect(next.restore(actor, cp, "new", f.manifest)).rejects.toThrow(
    "UPLOAD_CANCELLED",
  );
});
it("encrypts owned checkpoint records and retains claims and commit state after reconstruction", async () => {
  const f = await fixture(Buffer.from("secret body")),
    cp = f.service.checkpoint(actor, f.view.id),
    cache = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../.cache",
    ),
    root = await fs.mkdtemp(path.join(cache, "upload-store-"));
  closes.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== (await fs.realpath(cache)) ||
      !path.basename(actual).startsWith("upload-store-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const keys = new Map<string, Buffer>(),
    provider = {
      load: async (user: string, create: boolean) => {
        if (!keys.has(user) && create) keys.set(user, randomBytes(32));
        return keys.get(user) ?? null;
      },
    },
    store = new UploadRecoveryStore(root, provider),
    saved = await store.create("owner", cp),
    folders = await fs.readdir(path.join(root, "tandem-upload-recovery")),
    file = path.join(
      root,
      "tandem-upload-recovery",
      folders[0],
      saved.id + ".checkpoint",
    ),
    bytes = await fs.readFile(file);
  expect(bytes.includes(Buffer.from(cp.temporaryPath))).toBe(false);
  expect(bytes.includes(Buffer.from("target-key"))).toBe(false);
  const restarted = new UploadRecoveryStore(root, provider, () => false);
  expect((await restarted.get("owner", cp.id))?.checkpoint).toEqual(cp);
  expect(await restarted.list("other")).toEqual([]);
  const claimed = await store.claim("owner", cp.id);
  await expect(store.claim("owner", cp.id)).rejects.toThrow(
    "UPLOAD_RECOVERY_BUSY",
  );
  const reclaimed = await restarted.claim("owner", cp.id);
  await restarted.transition("owner", cp.id, reclaimed.claim!.id, "committing");
  await expect(
    new UploadRecoveryStore(root, provider, () => false).claim("owner", cp.id),
  ).rejects.toThrow("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
  keys.clear();
  await expect(restarted.get("owner", cp.id)).rejects.toThrow(
    "UPLOAD_RECOVERY_KEY_MISSING",
  );
  expect(claimed.id).toBe(cp.id);
});
