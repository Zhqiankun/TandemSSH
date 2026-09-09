import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { DownloadService } from "../../files/download-service";
import { registerDownloadTransferRoutes } from "../../hosts/file-manager/download-transfer-routes";
import { DOWNLOAD_CHUNK_BYTES } from "../../../types/file-download";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  let generation = "1",
    peer = remote.peerKey(),
    retained = 0;
  const audit = vi.fn(async () => {});
  const service = new DownloadService({
    audit,
    target: async (owner, session) => {
      if (owner !== "owner" || !["session", "reconnected"].includes(session))
        throw Error("FILE_SESSION_UNAVAILABLE");
      const original = generation;
      return {
        io: remote.io,
        key: "fixture",
        connection: generation,
        acceptedHostKey: peer,
        hostScope: { userId: owner, identity: "fixture@localhost" },
        check: () => {
          if (generation !== original) throw Error("FILE_CONNECTION_CHANGED");
        },
        retain: () => {
          retained++;
          return () => {
            retained--;
          };
        },
      };
    },
  });
  cleanup.push(() => service.dispose());
  return {
    remote,
    service,
    audit,
    retained: () => retained,
    change: (key = peer) => {
      generation = "2";
      peer = key;
    },
    prepare: (file = "/file.bin", requestId = randomUUID()) =>
      service.prepare(
        { userId: "owner" },
        { requestId, sessionId: "session", path: file },
      ),
  };
}
describe("bounded download sources over real SFTP", () => {
  it("reads a multi-block binary source, verifies its digest and releases its connection", async () => {
    const f = await fixture(),
      bytes = Buffer.alloc(DOWNLOAD_CHUNK_BYTES + 17, 143);
    bytes[4] = 0;
    await f.remote.write("/file.bin", bytes);
    const source = await f.prepare();
    expect(source.hashes).toHaveLength(2);
    expect(f.retained()).toBe(1);
    const actor = { userId: "owner" },
      parts = [
        await f.service.chunk(actor, source.id, 0),
        await f.service.chunk(actor, source.id, DOWNLOAD_CHUNK_BYTES),
      ];
    expect(Buffer.concat(parts).equals(bytes)).toBe(true);
    expect(source.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect((await f.service.verify(actor, source.id)).state).toBe("verified");
    expect(f.retained()).toBe(0);
  }, 15000);
  it("revokes cleared previews and requires a fresh source inspection, preserving remote files", async () => {
    const f = await fixture(),
      actor = { userId: "owner" },
      requestId = randomUUID();
    await f.remote.write("/file.bin", "before");
    const source = await f.prepare("/file.bin", requestId);
    expect(() => f.service.forget(actor, source.id)).toThrow(
      "DOWNLOAD_NOT_READY",
    );
    await f.service.verify(actor, source.id);
    expect(() => f.service.forget({ userId: "other" }, source.id)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    expect(f.service.forget(actor, source.id).state).toBe("verified");
    expect(() => f.service.get(actor, source.id)).toThrow("DOWNLOAD_NOT_FOUND");
    await f.remote.write("/file.bin", "after");
    const fresh = await f.prepare("/file.bin", requestId);
    expect(fresh.id).not.toBe(source.id);
    expect((await f.service.chunk(actor, fresh.id, 0)).toString()).toBe(
      "after",
    );
    await f.service.cancel(actor, fresh.id);
    expect(f.service.forget(actor, fresh.id).state).toBe("cancelled");
    expect(f.retained()).toBe(0);
  });

  it("continues beyond both record and request-cache limits when cancelled previews are explicitly cleared", async () => {
    const f = await fixture(),
      actor = { userId: "owner" };
    await f.remote.write("/file.bin", "bounded");
    for (let i = 0; i < 257; i++) {
      const source = await f.prepare();
      await f.service.cancel(actor, source.id);
      f.service.forget(actor, source.id);
    }
    const final = await f.prepare();
    expect((await f.service.chunk(actor, final.id, 0)).toString()).toBe(
      "bounded",
    );
    await f.service.cancel(actor, final.id);
    f.service.forget(actor, final.id);
    expect(f.retained()).toBe(0);
  }, 30000);
  it("detects same-size content changes and does not return substituted bytes", async () => {
    const f = await fixture();
    await f.remote.write("/file.bin", "original");
    const source = await f.prepare();
    await f.remote.write("/file.bin", "tampered");
    await expect(
      f.service.chunk({ userId: "owner" }, source.id, 0),
    ).rejects.toThrow("DOWNLOAD_SOURCE_CHANGED");
  });
  it("requires resume verification on another connection and rejects changed server identity", async () => {
    const f = await fixture();
    await f.remote.write("/file.bin", "resume");
    const source = await f.prepare(),
      actor = { userId: "owner" };
    await f.service.pause(actor, source.id);
    expect(f.retained()).toBe(0);
    f.change();
    await expect(f.service.chunk(actor, source.id, 0)).rejects.toThrow(
      "DOWNLOAD_NOT_READY",
    );
    await f.service.verify(actor, source.id, "reconnected");
    expect((await f.service.chunk(actor, source.id, 0)).toString()).toBe(
      "resume",
    );
    await f.service.pause(actor, source.id);
    f.change("changed-key");
    await expect(
      f.service.verify(actor, source.id, "reconnected"),
    ).rejects.toThrow("DOWNLOAD_HOST_IDENTITY_CHANGED");
  });
  it("isolates users, validates offsets, revokes cancellation, and handles empty files", async () => {
    const f = await fixture();
    await f.remote.write("/file.bin", "");
    const source = await f.prepare();
    expect(source.hashes).toEqual([]);
    expect(() => f.service.get({ userId: "other" }, source.id)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    await expect(
      f.service.chunk({ userId: "owner" }, source.id, 0),
    ).rejects.toThrow("DOWNLOAD_CHUNK_INVALID");
    await f.service.cancel({ userId: "owner" }, source.id);
    expect(f.retained()).toBe(0);
    await expect(
      f.service.verify({ userId: "owner" }, source.id),
    ).rejects.toThrow("DOWNLOAD_CANCELLED");
  });
  it("deduplicates preparation and fails closed when its audit cannot be saved", async () => {
    const f = await fixture();
    await f.remote.write("/file.bin", "same");
    const id = randomUUID();
    const [a, b] = await Promise.all([
      f.prepare("/file.bin", id),
      f.prepare("/file.bin", id),
    ]);
    expect(a.id).toBe(b.id);
    expect(f.retained()).toBe(1);
    expect(() => f.prepare("/other.bin", id)).toThrow(
      "DOWNLOAD_REQUEST_CONFLICT",
    );
    f.audit.mockRejectedValueOnce(Error("disk"));
    await expect(f.prepare()).rejects.toThrow("disk");
    expect(f.retained()).toBe(1);
  });
  it("enforces human-only HTTP access and bounded binary responses", async () => {
    const f = await fixture();
    await f.remote.write("/file.bin", "http");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        userId: req.headers["x-user"] ?? "owner",
        apiKeyId: req.headers["x-key"],
      });
      next();
    });
    registerDownloadTransferRoutes(app, f.service);
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const base =
      "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/ssh/file_manager/ssh/downloads";
    const body = JSON.stringify({
      requestId: randomUUID(),
      sessionId: "session",
      path: "/file.bin",
    });
    expect(
      (
        await fetch(base + "/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-key": "api" },
          body,
        })
      ).status,
    ).toBe(403);
    const response = await fetch(base + "/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const source = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      (await fetch(base + "/" + source.id, { headers: { "x-user": "other" } }))
        .status,
    ).toBe(404);
    expect(
      await (await fetch(base + "/" + source.id + "/chunk?offset=0")).text(),
    ).toBe("http");
    expect(
      (await fetch(base + "/" + source.id + "/chunk?offset=1")).status,
    ).toBe(409);
    expect(
      (
        await fetch(base + "/" + source.id + "/forget", {
          method: "POST",
          headers: { "x-key": "api" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(base + "/" + source.id + "/forget", {
          method: "POST",
          headers: { "x-user": "other" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await fetch(base + "/" + source.id + "/forget", { method: "POST" }))
        .status,
    ).toBe(409);
    expect(
      (await fetch(base + "/" + source.id + "/cancel", { method: "POST" }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(base + "/" + source.id + "/forget", { method: "POST" }))
        .status,
    ).toBe(200);
    expect((await fetch(base + "/" + source.id)).status).toBe(404);
  });
});

it("restores only the owning user's unchanged source on a newly verified connection", async () => {
  const f = await fixture(),
    actor = { userId: "owner" };
  await f.remote.write("/file.bin", "original");
  const preview = await f.prepare();
  expect(() => f.service.checkpoint(actor, preview.id)).toThrow(
    "DOWNLOAD_NOT_READY",
  );
  await f.service.pause(actor, preview.id);
  const checkpoint = f.service.checkpoint(actor, preview.id);
  expect(() =>
    f.service.restore(
      { userId: "other" },
      checkpoint,
      "reconnected",
      randomUUID(),
    ),
  ).toThrow("DOWNLOAD_NOT_FOUND");
  f.change("SHA256:other-server");
  await expect(
    f.service.restore(actor, checkpoint, "reconnected", randomUUID()),
  ).rejects.toThrow("DOWNLOAD_HOST_IDENTITY_CHANGED");
  expect(f.retained()).toBe(0);
  f.change(checkpoint.peer);
  const restored = await f.service.restore(
    actor,
    checkpoint,
    "reconnected",
    randomUUID(),
  );
  expect(restored.id).not.toBe(preview.id);
  expect((await f.service.chunk(actor, restored.id, 0)).toString()).toBe(
    "original",
  );
  await f.service.cancel(actor, restored.id);
  f.service.forget(actor, restored.id);
  // Keep the original stat metadata so this failure must be detected by content hashing.
  const stat = vi.spyOn(f.remote.io, "stat");
  stat.mockResolvedValue({ ...checkpoint.stat });
  const inspect = vi.spyOn(f.remote.io, "inspectFile");
  inspect.mockResolvedValue({
    stat: { ...checkpoint.stat },
    sha256: "0".repeat(64),
    hashes: ["0".repeat(64)],
    bytes: checkpoint.stat.size,
  });
  await expect(
    f.service.restore(actor, checkpoint, "reconnected", randomUUID()),
  ).rejects.toThrow("DOWNLOAD_SOURCE_CHANGED");
  expect(f.retained()).toBe(0);
  stat.mockRestore();
  inspect.mockRestore();
  expect(() =>
    f.service.restore(
      actor,
      { ...checkpoint, hashes: [] },
      "reconnected",
      randomUUID(),
    ),
  ).toThrow();
});
