import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService } from "../../files/upload-service";
import { UploadRecoveryStore } from "../../files/upload-recovery-store";
import { UploadRecoveryCoordinator } from "../../files/upload-recovery-coordinator";
import { FilePathLocks } from "../../files/path-locks";
const closes: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
async function fixture() {
  const remote = await fileSftpFixture();
  closes.push(() => remote.close());
  const cache = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../.cache",
    ),
    root = await fs.mkdtemp(path.join(cache, "upload-coordinator-"));
  closes.push(async () => {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== (await fs.realpath(cache)) ||
      !path.basename(actual).startsWith("upload-coordinator-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const bytes = Buffer.alloc(4194304 + 29, 23),
    manifest = {
      name: "source.bin",
      size: bytes.length,
      lastModified: 100,
      hashes: [
        createHash("sha256").update(bytes.subarray(0, 4194304)).digest("hex"),
        createHash("sha256").update(bytes.subarray(4194304)).digest("hex"),
      ],
    };
  let held = 0;
  const uploads = new UploadService({
    locks: new FilePathLocks(),
    target: async (user) => {
      if (user !== "owner") throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        io: remote.io,
        key: "test-target",
        connection: "current",
        acceptedHostKey: remote.peerKey(),
        hostScope: { userId: user, identity: "fixture" },
        check: () => {},
      };
    },
    beginWrite: () => {
      held++;
      return () => {
        held--;
      };
    },
    audit: async () => {},
  });
  closes.push(() => uploads.dispose());
  const key = randomBytes(32),
    store = new UploadRecoveryStore(
      root,
      { load: async () => key },
      () => false,
    ),
    coordinator = new UploadRecoveryCoordinator(uploads, store, () => true),
    token = randomUUID();
  coordinator.bind(token);
  closes.push(() => coordinator.close(token));
  const prepared = await uploads.prepare(actor, {
    sessionId: "session",
    requestId: randomUUID(),
    path: "/result.bin",
    manifest,
  });
  await uploads.start(actor, prepared.id, { overwrite: false });
  await uploads.chunk(actor, prepared.id, 0, bytes.subarray(0, 4194304));
  await uploads.pause(actor, prepared.id);
  return {
    remote,
    bytes,
    manifest,
    uploads,
    store,
    coordinator,
    token,
    prepared,
    held: () => held,
  };
}
it("saves, restores paused, and preserves the remote part when a window closes", async () => {
  const f = await fixture(),
    saved = await f.coordinator.save(actor, f.token, f.prepared.id);
  expect(saved.state).toBe("available");
  expect(() => f.uploads.get(actor, f.prepared.id)).toThrow("UPLOAD_NOT_FOUND");
  const r = await f.coordinator.restore(
    actor,
    f.token,
    saved.id,
    "session",
    f.manifest,
    false,
  );
  expect(r.view.state).toBe("paused");
  expect(f.held()).toBe(0);
  const part = r.view.temporaryPath!;
  await f.coordinator.close(f.token);
  expect((await f.remote.read(part)).length).toBe(4194304);
  expect((await f.store.get("owner", saved.id))?.state).toBe("available");
  expect(() => f.uploads.get(actor, r.view.id)).toThrow("UPLOAD_NOT_FOUND");
});
it("stops a late block before releasing its record on window close", async () => {
  const f = await fixture(),
    saved = await f.coordinator.save(actor, f.token, f.prepared.id),
    r = await f.coordinator.restore(
      actor,
      f.token,
      saved.id,
      "session",
      f.manifest,
      false,
    );
  await f.uploads.resume(actor, r.view.id, "session");
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    write = f.remote.io.writeAt.bind(f.remote.io);
  vi.spyOn(f.remote.io, "writeAt").mockImplementationOnce(async (...args) => {
    enter();
    await gate;
    return write(...args);
  });
  const chunk = f.uploads.chunk(
    actor,
    r.view.id,
    4194304,
    f.bytes.subarray(4194304),
  );
  await entered;
  const close = f.coordinator.close(f.token);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await chunk;
  await close;
  expect(f.held()).toBe(0);
  expect((await f.remote.read(r.view.temporaryPath!)).length).toBe(4194304);
  expect((await f.store.get("owner", saved.id))?.state).toBe("available");
});
it("journals uncertain remote commits and only reconciles the resulting content", async () => {
  const f = await fixture(),
    saved = await f.coordinator.save(actor, f.token, f.prepared.id),
    r = await f.coordinator.restore(
      actor,
      f.token,
      saved.id,
      "session",
      f.manifest,
      false,
    );
  await f.uploads.resume(actor, r.view.id, "session");
  await f.uploads.chunk(actor, r.view.id, 4194304, f.bytes.subarray(4194304));
  const replace = f.remote.io.replace.bind(f.remote.io);
  vi.spyOn(f.remote.io, "replace").mockImplementationOnce(async (...args) => {
    await replace(...args);
    throw Error("LOST_REPLY");
  });
  const done = (await f.coordinator.finish(actor, r.view.id)) as {
    state: string;
  };
  expect(done.state).toBe("unknown");
  expect((await f.store.get("owner", saved.id))?.state).toBe("unknown");
  await expect(
    f.coordinator.restore(
      actor,
      f.token,
      saved.id,
      "session",
      f.manifest,
      false,
    ),
  ).rejects.toThrow("UPLOAD_RECOVERY_RECONCILE_REQUIRED");
  const checked = await f.coordinator.check(
    actor,
    f.token,
    saved.id,
    "session",
    false,
  );
  expect(checked.summary.state).toBe("completed");
  expect(checked.view?.state).toBe("completed");
  expect((await f.remote.read("/result.bin")).equals(f.bytes)).toBe(true);
});
it("isolates users and rejects unknown window tokens before reading records", async () => {
  const f = await fixture(),
    saved = await f.coordinator.save(actor, f.token, f.prepared.id);
  await expect(f.coordinator.list(actor, randomUUID())).rejects.toThrow(
    "UPLOAD_RECOVERY_WINDOW_CLOSED",
  );
  await expect(
    f.coordinator.list({ userId: "other" }, f.token),
  ).rejects.toThrow("UPLOAD_RECOVERY_WINDOW_CLOSED");
  const token = randomUUID();
  f.coordinator.bind(token);
  expect(await f.coordinator.list({ userId: "other" }, token)).toEqual([]);
  await expect(
    f.coordinator.detail({ userId: "other" }, token, saved.id),
  ).rejects.toThrow("UPLOAD_RECOVERY_NOT_FOUND");
  await f.coordinator.close(token);
});
it("updates the same recovery record after pausing again, then discards only its part", async () => {
  const f = await fixture(),
    saved = await f.coordinator.save(actor, f.token, f.prepared.id),
    r = await f.coordinator.restore(
      actor,
      f.token,
      saved.id,
      "session",
      f.manifest,
      false,
    );
  await f.uploads.resume(actor, r.view.id, "session");
  await f.uploads.chunk(actor, r.view.id, 4194304, f.bytes.subarray(4194304));
  await f.uploads.pause(actor, r.view.id);
  const next = await f.coordinator.save(actor, f.token, r.view.id);
  expect(next.id).toBe(saved.id);
  expect(next.receivedBytes).toBe(f.bytes.length);
  expect(await f.coordinator.list(actor, f.token)).toHaveLength(1);
  await f.coordinator.discard(actor, f.token, saved.id, "session", false);
  expect((await f.store.get("owner", saved.id))?.state).toBe("cancelled");
  await expect(f.remote.read(r.view.temporaryPath!)).rejects.toThrow();
});
