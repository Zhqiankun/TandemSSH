import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService, type UploadTarget } from "../../files/upload-service";
import { FilePathLocks } from "../../files/path-locks";
import { DocumentError } from "../../files/errors";
import { registerUploadRoutes } from "../../hosts/file-manager/upload-routes";
import {
  UPLOAD_CHUNK_BYTES,
  type UploadManifest,
  type UploadView,
} from "../../../types/file-upload";
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const actor = { userId: "owner" };
function manifest(bytes: Buffer): UploadManifest {
  const hashes: string[] = [];
  for (let i = 0; i < bytes.length; i += UPLOAD_CHUNK_BYTES)
    hashes.push(
      createHash("sha256")
        .update(bytes.subarray(i, i + UPLOAD_CHUNK_BYTES))
        .digest("hex"),
    );
  return { name: "应用.bin", size: bytes.length, lastModified: 100, hashes };
}
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  let retained = 0,
    automation = false,
    takeovers = 0;
  const sessions = new Map([
      [
        "session-1",
        { io: remote.io, connection: "1", acceptedHostKey: remote.peerKey() },
      ],
    ]),
    events: unknown[] = [],
    audit = vi.fn(async (_owner: string, type: string, data: unknown) => {
      events.push({ type, data });
    });
  const service = new UploadService({
    locks: new FilePathLocks(),
    audit,
    target: async (userId, sessionId) => {
      const session = sessions.get(sessionId);
      if (userId !== "owner" || !session)
        throw new DocumentError("FILE_SESSION_UNAVAILABLE");
      const t: UploadTarget = {
        key: "owner-fixture",
        connection: session.connection,
        acceptedHostKey: session.acceptedHostKey,
        io: session.io,
        hostScope: { userId, hostId: 7, identity: "fixture@localhost" },
        retain: () => {
          retained++;
          return () => {
            retained--;
          };
        },
        check: () => {
          if (sessions.get(sessionId) !== session)
            throw new DocumentError("FILE_CONNECTION_CHANGED");
        },
      };
      return t;
    },
    beginWrite: (_owner, _target, takeover) => {
      if (automation && !takeover)
        throw new DocumentError("FILE_AUTOMATION_ACTIVE");
      if (automation) {
        takeovers++;
        automation = false;
      }
      return () => {};
    },
  });
  cleanup.push(() => service.dispose());
  const prepare = (
    bytes: Buffer,
    path = "/目录/上传文件.bin",
    requestId = randomUUID(),
  ) =>
    service.prepare(actor, {
      sessionId: "session-1",
      path,
      requestId,
      manifest: manifest(bytes),
    });
  return {
    remote,
    service,
    prepare,
    events,
    audit,
    sessions,
    retained: () => retained,
    setAutomation: (v: boolean) => (automation = v),
    takeovers: () => takeovers,
  };
}
describe("verified staged uploads over actual SFTP", () => {
  it("uploads multiple binary chunks, deduplicates a repeated chunk and verifies the actual committed target", async () => {
    const f = await fixture(),
      bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 513, 0xa5),
      prepared = await f.prepare(bytes, "/目录/新 %2F.bin");
    expect(prepared.state).toBe("preview");
    expect(f.remote.writes()).toBe(0);
    const started = await f.service.start(actor, prepared.id, {
      overwrite: false,
    });
    expect(started.state).toBe("uploading");
    expect(f.retained()).toBe(1);
    await expect(f.remote.read(prepared.path)).rejects.toThrow();
    const first = bytes.subarray(0, UPLOAD_CHUNK_BYTES);
    await f.service.chunk(actor, prepared.id, 0, first);
    const writes = f.remote.writes();
    expect(
      (await f.service.chunk(actor, prepared.id, 0, first)).receivedBytes,
    ).toBe(first.length);
    expect(f.remote.writes()).toBe(writes);
    await f.service.chunk(
      actor,
      prepared.id,
      first.length,
      bytes.subarray(first.length),
    );
    const done = await f.service.finish(actor, prepared.id);
    expect(done).toMatchObject({
      state: "completed",
      atomic: false,
      verification: "sha256",
      receivedBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await f.remote.read(prepared.path)).toEqual(bytes);
    expect(f.retained()).toBe(0);
    const renameCount = f.remote.renames();
    expect(await f.service.finish(actor, prepared.id)).toEqual(done);
    expect(f.remote.renames()).toBe(renameCount);
    expect(f.remote.connections()).toBe(1);
  }, 15000);
  it("handles an empty file and refuses changed source bytes before writing", async () => {
    const f = await fixture(),
      empty = await f.prepare(Buffer.alloc(0));
    await f.service.start(actor, empty.id, { overwrite: false });
    expect((await f.service.finish(actor, empty.id)).state).toBe("completed");
    expect((await f.remote.read(empty.path)).length).toBe(0);
    const next = await f.prepare(Buffer.from("expected"), "/目录/second");
    const started = await f.service.start(actor, next.id, { overwrite: false });
    expect(() =>
      f.service.chunk(actor, next.id, 0, Buffer.from("changed!")),
    ).toThrow("UPLOAD_SOURCE_CHANGED");
    expect((await f.remote.read(started.temporaryPath!)).length).toBe(0);
  });
  it("keeps the original intact when it changes after preview or the server cannot atomically replace it", async () => {
    const f = await fixture(),
      original = "/目录/配置%2F.txt",
      p = await f.prepare(Buffer.from("new"), original);
    expect(
      (await f.service.start(actor, p.id, { overwrite: false })).error,
    ).toBe("UPLOAD_OVERWRITE_REQUIRED");
    expect(
      (await f.service.start(actor, p.id, { overwrite: true })).state,
    ).toBe("uploading");
    await f.service.chunk(actor, p.id, 0, Buffer.from("new"));
    await f.remote.write(original, "external change");
    const result = await f.service.finish(actor, p.id);
    expect(result.state).toBe("failed");
    expect(result.error).toBe("FILE_CONFLICT");
    expect((await f.remote.read(original)).toString()).toBe("external change");
    expect(f.retained()).toBe(0);
    const p2 = await f.prepare(Buffer.from("another"), original);
    await f.service.start(actor, p2.id, { overwrite: true });
    await f.service.chunk(actor, p2.id, 0, Buffer.from("another"));
    const unsupported = await f.service.finish(actor, p2.id);
    expect(unsupported).toMatchObject({
      state: "failed",
      error: "FILE_ATOMIC_REPLACE_UNSUPPORTED",
      commitMayHaveOccurred: false,
    });
    expect((await f.remote.read(original)).toString()).toBe("external change");
  });
  it("pauses and resumes on a new authenticated connection after verifying and truncating an unconfirmed tail", async () => {
    const f = await fixture(),
      bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 7, 0x42),
      p = await f.prepare(bytes);
    await f.service.start(actor, p.id, { overwrite: false });
    const first = await f.service.chunk(
      actor,
      p.id,
      0,
      bytes.subarray(0, UPLOAD_CHUNK_BYTES),
    );
    await f.remote.io.writeAt(
      first.temporaryPath!,
      first.receivedBytes,
      Buffer.from("tail"),
      () => {},
    );
    expect((await f.service.pause(actor, p.id)).state).toBe("paused");
    expect(f.retained()).toBe(0);
    f.remote.client.end();
    f.sessions.delete("session-1");
    const next = await f.remote.reconnect();
    f.sessions.set("session-2", {
      io: next.io,
      connection: "2",
      acceptedHostKey: f.remote.peerKey(),
    });
    const resumed = await f.service.resume(actor, p.id, "session-2");
    expect(resumed).toMatchObject({
      state: "uploading",
      receivedBytes: UPLOAD_CHUNK_BYTES,
      sessionId: "session-2",
    });
    expect((await next.io.stat(resumed.temporaryPath!)).size).toBe(
      UPLOAD_CHUNK_BYTES,
    );
    await f.service.chunk(
      actor,
      p.id,
      UPLOAD_CHUNK_BYTES,
      bytes.subarray(UPLOAD_CHUNK_BYTES),
    );
    expect((await f.service.finish(actor, p.id)).state).toBe("completed");
    expect(await f.remote.read(p.path)).toEqual(bytes);
    expect(f.remote.connections()).toBe(2);
  }, 15000);
  it("refuses a modified checkpoint, and only cleans a temporary file acknowledged as created by this upload", async () => {
    const f = await fixture(),
      bytes = Buffer.from("payload"),
      p = await f.prepare(bytes);
    const start = await f.service.start(actor, p.id, { overwrite: false });
    await f.service.chunk(actor, p.id, 0, bytes);
    await f.service.pause(actor, p.id);
    await f.remote.write(start.temporaryPath!, "changed");
    expect((await f.service.resume(actor, p.id, "session-1")).error).toBe(
      "UPLOAD_CHECKPOINT_CHANGED",
    );
    const cancelled = await f.service.cancel(actor, p.id, true);
    expect(cancelled).toMatchObject({ state: "cancelled" });
    expect(cancelled.temporaryPath).toBeUndefined();
    await expect(f.remote.read(start.temporaryPath!)).rejects.toThrow();
    const other = await f.prepare(bytes, "/目录/collision");
    vi.spyOn(f.remote.io, "createExclusive").mockImplementationOnce(
      async (path) => {
        await f.remote.write(path, "someone else");
        throw new DocumentError("FILE_ALREADY_EXISTS");
      },
    );
    const failed = await f.service.start(actor, other.id, { overwrite: false });
    const cleanupResult = await f.service.cancel(actor, other.id, true);
    expect(cleanupResult.error).toBe("UPLOAD_TEMPORARY_UNVERIFIED");
    expect((await f.remote.read(failed.temporaryPath!)).toString()).toBe(
      "someone else",
    );
  });
  it("requires takeover when automation is active, preserves ownership and blocks staging when audit fails", async () => {
    const f = await fixture(),
      p = await f.prepare(Buffer.from("private-source"));
    f.setAutomation(true);
    const blocked = await f.service.start(actor, p.id, { overwrite: false });
    expect(blocked).toMatchObject({
      state: "preview",
      error: "FILE_AUTOMATION_ACTIVE",
    });
    expect(blocked.temporaryPath).toBeUndefined();
    expect(f.retained()).toBe(0);
    expect(() => f.service.get({ userId: "other" }, p.id)).toThrow(
      "UPLOAD_NOT_FOUND",
    );
    expect(
      (await f.service.start(actor, p.id, { overwrite: false, takeover: true }))
        .state,
    ).toBe("uploading");
    expect(f.takeovers()).toBe(1);
    expect(JSON.stringify(f.events)).not.toContain("private-source");
    await f.service.cancel(actor, p.id, true);
    const p2 = await f.prepare(Buffer.from("source"), "/目录/audit");
    f.audit.mockRejectedValueOnce(Error("disk full"));
    const r = await f.service.start(actor, p2.id, { overwrite: false });
    expect(r.state).toBe("preview");
    expect(r.temporaryPath).toBeUndefined();
    expect(f.retained()).toBe(0);
  });
  it("returns unknown after an acknowledged rename whose post-commit verification fails, and never retries it", async () => {
    const f = await fixture(),
      bytes = Buffer.from("saved"),
      p = await f.prepare(bytes);
    await f.service.start(actor, p.id, { overwrite: false });
    await f.service.chunk(actor, p.id, 0, bytes);
    const original = f.remote.io.inspectFile.bind(f.remote.io);
    vi.spyOn(f.remote.io, "inspectFile").mockImplementation(
      async (path, ...args) => {
        if (path === p.canonicalPath) throw new DocumentError("FILE_IO_FAILED");
        return original(path, ...args);
      },
    );
    const unknown = await f.service.finish(actor, p.id);
    expect(unknown).toMatchObject({
      state: "unknown",
      commitMayHaveOccurred: true,
    });
    expect((await f.remote.read(p.path)).toString()).toBe("saved");
    const count = f.remote.renames();
    expect(await f.service.finish(actor, p.id)).toEqual(unknown);
    expect(await f.service.cancel(actor, p.id, true)).toEqual(unknown);
    expect(f.remote.renames()).toBe(count);
  });
});
it("the real upload HTTP route receives bounded raw bytes, blocks API keys and no longer accepts legacy direct writes", async () => {
  const f = await fixture(),
    app = express();
  let userId = "owner",
    apiKeyId: string | undefined;
  app.use(express.json({ limit: "2mb" }));
  app.use(express.raw({ type: "application/octet-stream", limit: "8mb" }));
  app.use((req, _res, next) => {
    Object.assign(req, { userId, apiKeyId });
    next();
  });
  registerUploadRoutes(app, f.service);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/ssh/file_manager/ssh/uploads";
  const post = async (url: string, body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const bytes = Buffer.from("真实 HTTP 原始分块\0binary"),
    created = await post(base + "/prepare", {
      requestId: randomUUID(),
      sessionId: "session-1",
      path: "/目录/http.bin",
      manifest: manifest(bytes),
    });
  expect(created.status).toBe(200);
  const preview = (await created.json()) as UploadView;
  apiKeyId = "key";
  expect(
    (await post(base + "/" + preview.id + "/start", { overwrite: false }))
      .status,
  ).toBe(403);
  apiKeyId = undefined;
  userId = "other";
  expect((await fetch(base + "/" + preview.id)).status).toBe(404);
  userId = "owner";
  expect(
    (await post(base + "/" + preview.id + "/start", { overwrite: false }))
      .status,
  ).toBe(200);
  const chunk = await fetch(base + "/" + preview.id + "/chunk?offset=0", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob([Uint8Array.from(bytes)]),
  });
  expect(chunk.status).toBe(200);
  expect(await chunk.json()).toMatchObject({
    receivedBytes: bytes.length,
    state: "uploading",
  });
  const done = await post(base + "/" + preview.id + "/finish", {});
  expect(await done.json()).toMatchObject({
    state: "completed",
    verification: "sha256",
  });
  expect(await f.remote.read(preview.path)).toEqual(bytes);
  const legacy = await post(
    base.replace(/\/uploads$/, "") + "/uploadFileChunk",
    {},
  );
  expect(legacy.status).toBe(409);
  expect(await legacy.json()).toEqual({ error: "UPLOAD_PREVIEW_REQUIRED" });
});
it.each(["changed", "missing"] as const)(
  "does not resume on a new connection with %s original host-key continuity",
  async (scenario) => {
    const f = await fixture();
    if (scenario === "missing")
      f.sessions.get("session-1")!.acceptedHostKey = undefined;
    const p = await f.prepare(Buffer.from("checkpoint"));
    await f.service.start(actor, p.id, { overwrite: false });
    await f.service.chunk(actor, p.id, 0, Buffer.from("checkpoint"));
    await f.service.pause(actor, p.id);
    f.sessions.set("session-2", {
      io: f.remote.io,
      connection: "2",
      acceptedHostKey:
        scenario === "changed" ? "SHA256:different" : f.remote.peerKey(),
    });
    const inspect = vi.spyOn(f.remote.io, "inspectFile");
    const resumed = await f.service.resume(actor, p.id, "session-2");
    expect(resumed.state).toBe("failed");
    expect(resumed.error).toBe(
      scenario === "changed"
        ? "UPLOAD_HOST_IDENTITY_CHANGED"
        : "UPLOAD_HOST_IDENTITY_UNVERIFIED",
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(f.retained()).toBe(0);
  },
);

it("will not clean an old temporary path after the server key changes", async () => {
  const f = await fixture(),
    p = await f.prepare(Buffer.from("data"));
  const started = await f.service.start(actor, p.id, { overwrite: false });
  f.sessions.get("session-1")!.acceptedHostKey = "SHA256:changed";
  const remove = vi.spyOn(f.remote.io, "remove");
  const result = await f.service.cancel(actor, p.id, true);
  expect(result.error).toBe("UPLOAD_HOST_IDENTITY_CHANGED");
  expect(result.temporaryPath).toBe(started.temporaryPath);
  expect(remove).not.toHaveBeenCalled();
});
