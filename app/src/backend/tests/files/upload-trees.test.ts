import express from "express";
import { createServer } from "node:http";
import { registerUploadRoutes } from "../../hosts/file-manager/upload-routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import { UploadService, type UploadPorts } from "../../files/upload-service";
import { UploadTreeService } from "../../files/upload-tree-service";
import { FilePathLocks } from "../../files/path-locks";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
const mappings = [
  {
    id: "dir",
    name: "应用",
    kind: "directory" as const,
    size: 0,
    lastModified: 0,
  },
  {
    id: "empty",
    parentId: "dir",
    name: "空目录",
    kind: "directory" as const,
    size: 0,
    lastModified: 0,
  },
  {
    id: "file",
    parentId: "dir",
    name: "结果 %.txt",
    kind: "file" as const,
    size: 4,
    lastModified: 100,
  },
];
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  await remote.mkdir("/dest");
  let automation = false,
    peer = remote.peerKey(),
    retained = 0,
    takeovers = 0;
  const ports: UploadPorts = {
    locks: new FilePathLocks(),
    audit: vi.fn(async () => {}),
    target: async (user, session) => {
      if (user !== "owner" || session !== "session")
        throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        key: "fixture",
        acceptedHostKey: peer,
        connection: "session",
        io: remote.io,
        check: () => {},
        retain: () => {
          retained++;
          return () => {
            retained--;
          };
        },
      };
    },
    beginWrite: (_user, _target, takeover) => {
      if (automation && !takeover) throw Error("FILE_AUTOMATION_ACTIVE");
      if (automation) {
        automation = false;
        takeovers++;
      }
      return () => {};
    },
  };
  const uploads = new UploadService(ports),
    trees = new UploadTreeService(ports, uploads);
  cleanup.push(
    () => uploads.dispose(),
    () => trees.dispose(),
  );
  const preview = (entries = mappings) =>
    trees.preview(actor, { sessionId: "session", path: "/dest", entries });
  const confirm = async (
    p: Awaited<ReturnType<typeof preview>>,
    action: "create" | "merge" | "overwrite" | "skip" = "create",
  ) =>
    trees.confirm(
      actor,
      p.id,
      p.revision,
      p.entries.map((e) => ({
        id: e.id,
        action: e.status === "new" ? "create" : action,
      })),
    );
  return {
    remote,
    ports,
    uploads,
    trees,
    preview,
    confirm,
    retained: () => retained,
    automation: () => {
      automation = true;
    },
    takeovers: () => takeovers,
    changePeer: () => {
      peer = "SHA256:different";
    },
  };
}
const manifest = (bytes: Buffer) => ({
  name: "local.txt",
  size: bytes.length,
  lastModified: 100,
  hashes: [createHash("sha256").update(bytes).digest("hex")],
});
describe("reviewed directory uploads over real SFTP", () => {
  it("does not write before confirmation and uploads through the existing verified engine", async () => {
    const f = await fixture(),
      p = await f.preview();
    await expect(f.remote.io.stat("/dest/应用")).rejects.toThrow(
      "FILE_NOT_FOUND",
    );
    await expect(f.trees.directories(actor, p.id)).rejects.toThrow(
      "UPLOAD_STATE_INVALID",
    );
    await f.confirm(p);
    const dirs = await f.trees.directories(actor, p.id);
    expect(dirs.map((e) => e.state)).toEqual(["created", "created"]);
    expect(dirs[0].mode).toBe(0o700);
    const bytes = Buffer.from("data"),
      prepared = await f.trees.prepareEntry(
        actor,
        p.id,
        "file",
        "session",
        randomUUID(),
        manifest(bytes),
      );
    expect(
      (await f.uploads.start(actor, prepared.id, { overwrite: false })).state,
    ).toBe("uploading");
    await f.uploads.chunk(actor, prepared.id, 0, bytes);
    expect((await f.uploads.finish(actor, prepared.id)).state).toBe(
      "completed",
    );
    expect(await f.remote.read("/dest/应用/结果 %.txt")).toEqual(bytes);
    expect(await f.remote.io.list!("/dest/应用/空目录", 10, () => {})).toEqual(
      [],
    );
    f.uploads.forget(actor, prepared.id);
    f.trees.forget(actor, p.id);
    expect(f.retained()).toBe(0);
    expect(f.ports.audit).toHaveBeenCalledWith(
      "owner",
      "upload.directory.created",
      expect.objectContaining({ path: "/dest/应用" }),
    );
  });
  it("requires directory merge and binds file overwrite to its original contents", async () => {
    const f = await fixture();
    await f.remote.mkdir("/dest/应用");
    await f.remote.write("/dest/应用/结果 %.txt", "old");
    const p = await f.preview();
    await expect(f.confirm(p)).rejects.toThrow("UPLOAD_OVERWRITE_REQUIRED");
    await f.trees.confirm(
      actor,
      p.id,
      p.revision,
      p.entries.map((e) => ({
        id: e.id,
        action:
          e.status === "directory"
            ? "merge"
            : e.status === "conflict"
              ? "overwrite"
              : "create",
      })),
    );
    await f.trees.directories(actor, p.id);
    await f.remote.write("/dest/应用/结果 %.txt", "changed after review");
    await expect(
      f.trees.prepareEntry(
        actor,
        p.id,
        "file",
        "session",
        randomUUID(),
        manifest(Buffer.from("data")),
      ),
    ).rejects.toThrow("FILE_CONFLICT");
    expect((await f.remote.read("/dest/应用/结果 %.txt")).toString()).toBe(
      "changed after review",
    );
  });
  it("does not take over automation for a fully skipped batch", async () => {
    const f = await fixture(),
      p = await f.preview();
    await f.trees.confirm(
      actor,
      p.id,
      p.revision,
      p.entries.map((e) => ({ id: e.id, action: "skip" })),
    );
    f.automation();
    expect(
      (await f.trees.directories(actor, p.id)).every(
        (e) => e.state === "skipped",
      ),
    ).toBe(true);
    expect(f.takeovers()).toBe(0);
  });
  it("checks parent links again when a prepared file is started", async () => {
    const f = await fixture(),
      p = await f.preview();
    await f.confirm(p);
    await f.trees.directories(actor, p.id);
    const upload = await f.trees.prepareEntry(
      actor,
      p.id,
      "file",
      "session",
      randomUUID(),
      manifest(Buffer.from("data")),
    );
    await f.remote.io.replace("/dest/应用", "/dest/moved", false, () => {});
    await f.remote.mkdir("/outside");
    await f.remote.symlinkDirectory("/dest/应用", "/outside");
    expect(
      await f.uploads.start(actor, upload.id, { overwrite: false }),
    ).toMatchObject({ state: "preview", error: "FILE_TARGET_CHANGED" });
    await expect(f.remote.io.stat("/outside/结果 %.txt")).rejects.toThrow(
      "FILE_NOT_FOUND",
    );
  });
  it("keeps HTTP directory creation human-only and prevents replacing the stored file target", async () => {
    const f = await fixture(),
      app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        userId: req.headers["x-user"] ?? "owner",
        apiKeyId: req.headers["x-key"],
      });
      next();
    });
    registerUploadRoutes(app, f.uploads, f.trees);
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
      "/ssh/file_manager/ssh/uploads";
    const body = JSON.stringify({
      sessionId: "session",
      path: "/dest",
      entries: mappings,
    });
    expect(
      (
        await fetch(base + "/trees/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-key": "api" },
          body,
        })
      ).status,
    ).toBe(403);
    const response = await fetch(base + "/trees/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const p = await response.json();
    expect(
      (await fetch(base + "/trees/" + p.id, { headers: { "x-user": "other" } }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(base + "/trees/" + p.id + "/directories", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-key": "api" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const payload = {
      sessionId: "session",
      requestId: randomUUID(),
      manifest: manifest(Buffer.from("data")),
      path: "/outside",
    };
    expect(
      (
        await fetch(base + "/trees/" + p.id + "/entries/file/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(409);
    await f.confirm(p);
    await f.trees.directories(actor, p.id);
    const bytes = Buffer.from("data"),
      file = await f.trees.prepareEntry(
        actor,
        p.id,
        "file",
        "session",
        randomUUID(),
        manifest(bytes),
      );
    await f.uploads.start(actor, file.id, { overwrite: false });
    await f.uploads.chunk(actor, file.id, 0, bytes);
    await f.uploads.finish(actor, file.id);
    const endpoint = base + "/trees/" + p.id + "/entries/file/complete";
    const request = (
      extra: Record<string, string> = {},
      data: object = { uploadId: file.id },
    ) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extra },
        body: JSON.stringify(data),
      });
    expect((await request({ "x-key": "api" })).status).toBe(403);
    expect((await request({ "x-user": "other" })).status).toBe(404);
    expect(
      (await request({}, { uploadId: file.id, sha256: "forged" })).status,
    ).toBe(409);
    const receipt = await request();
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toMatchObject({
      state: "completed",
      bytes: 4,
      transferId: file.id,
    });
  });
  it("requires human takeover before directory creation when automation controls the host", async () => {
    const f = await fixture(),
      p = await f.preview();
    await f.confirm(p);
    f.automation();
    await expect(f.trees.directories(actor, p.id)).rejects.toThrow(
      "FILE_AUTOMATION_ACTIVE",
    );
    await expect(f.remote.io.stat("/dest/应用")).rejects.toThrow(
      "FILE_NOT_FOUND",
    );
    expect((await f.trees.directories(actor, p.id, true))[0].state).toBe(
      "created",
    );
    expect(f.takeovers()).toBe(1);
  });
  it("protects another user, detects changed server identity and rejects linked targets", async () => {
    const f = await fixture();
    await f.remote.mkdir("/outside");
    await f.remote.symlinkDirectory("/dest/应用", "/outside");
    const p = await f.preview();
    expect(p.entries[0]).toMatchObject({
      status: "blocked",
      error: "UPLOAD_TREE_TYPE_CONFLICT",
    });
    expect(() => f.trees.get({ userId: "other" }, p.id)).toThrow(
      "UPLOAD_NOT_FOUND",
    );
    await expect(
      f.trees.confirm({ userId: "other" }, p.id, p.revision, []),
    ).rejects.toThrow("UPLOAD_NOT_FOUND");
    const next = await f.preview([
      { id: "new", name: "other", kind: "directory", size: 0, lastModified: 0 },
    ]);
    await f.confirm(next);
    f.changePeer();
    await expect(f.trees.directories(actor, next.id)).rejects.toThrow(
      "UPLOAD_HOST_IDENTITY_CHANGED",
    );
  });
  it("retains an unknown result if a post-create audit fails and never retries that mkdir", async () => {
    const f = await fixture(),
      p = await f.preview([
        {
          id: "d",
          name: "created",
          kind: "directory",
          size: 0,
          lastModified: 0,
        },
      ]);
    await f.confirm(p);
    vi.mocked(f.ports.audit).mockImplementation(async (_user, event) => {
      if (event === "upload.directory.created")
        throw Error("AUDIT_UNAVAILABLE");
    });
    const mkdir = vi.spyOn(f.remote.io, "mkdir");
    expect((await f.trees.directories(actor, p.id))[0].state).toBe("unknown");
    expect((await f.remote.io.stat("/dest/created")).kind).toBe("directory");
    expect((await f.trees.directories(actor, p.id))[0].state).toBe("unknown");
    expect(mkdir).toHaveBeenCalledOnce();
    expect(() => f.trees.forget(actor, p.id)).toThrow("UPLOAD_CLEANUP_PENDING");
  });
  it("uses the shared target lock and can retry a known failed directory after it is released", async () => {
    const f = await fixture(),
      p = await f.preview([
        {
          id: "d",
          name: "locked",
          kind: "directory",
          size: 0,
          lastModified: 0,
        },
      ]);
    await f.confirm(p);
    const unlock = f.ports.locks.acquire("fixture\0/dest/locked");
    try {
      expect((await f.trees.directories(actor, p.id))[0]).toMatchObject({
        state: "failed",
        error: "FILE_BUSY",
      });
    } finally {
      unlock();
    }
    expect((await f.trees.directories(actor, p.id))[0].state).toBe("created");
  });
});
it("creates only one selected remote directory for one task operation", async () => {
  const f = await fixture(),
    preview = await f.preview();
  await f.confirm(preview);
  await expect(
    f.trees.directories(actor, preview.id, false, "missing"),
  ).rejects.toThrow("FILE_DIRECTORY_ENTRY_INVALID");
  const first = await f.trees.directories(actor, preview.id, false, "dir");
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ id: "dir", state: "created" });
  await expect(f.remote.io.stat("/dest/应用/空目录")).rejects.toThrow();
  const second = await f.trees.directories(actor, preview.id, false, "empty");
  expect(second).toHaveLength(1);
  expect(second[0]).toMatchObject({ id: "empty", state: "created" });
});
