import express from "express";
import { createServer } from "node:http";
import { registerDownloadTransferRoutes } from "../../hosts/file-manager/download-transfer-routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import {
  DownloadService,
  type DownloadPorts,
} from "../../files/download-service";
import { DownloadTreeService } from "../../files/download-tree-service";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  let peer = remote.peerKey(),
    retained = 0;
  const ports: DownloadPorts = {
    audit: vi.fn(async () => {}),
    target: async (userId, sessionId) => {
      if (userId !== "owner" || !["session", "new-session"].includes(sessionId))
        throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        io: remote.io,
        key: "fixture",
        acceptedHostKey: peer,
        connection: sessionId,
        hostScope: { userId, identity: "tree@localhost" },
        check: () => {},
        retain: () => {
          retained++;
          return () => {
            retained--;
          };
        },
      };
    },
  };
  const downloads = new DownloadService(ports),
    trees = new DownloadTreeService(ports, downloads);
  cleanup.push(
    () => downloads.dispose(),
    () => trees.dispose(),
  );
  return {
    remote,
    downloads,
    trees,
    ports,
    retained: () => retained,
    changePeer: () => {
      peer = "SHA256:changed";
    },
    scan: (paths = ["/folder"]) =>
      trees.scan({ userId: "owner" }, { sessionId: "session", paths }),
  };
}
const actor = { userId: "owner" };
describe("recursive download source plans over real SFTP", () => {
  it("lists nested files and empty directories once, preserves names and reads only selected entries", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder/空 目录");
    await f.remote.mkdir("/folder/sub");
    await f.remote.write("/folder/sub/结果 %.txt", "content");
    await f.remote.write("/folder/root.bin", "root");
    const preview = await f.scan([
      "/folder/sub/结果 %.txt",
      "/folder",
      "/folder/sub",
    ]);
    expect(preview.entries.map((e) => e.relativePath).sort()).toEqual(
      [
        "folder",
        "folder/空 目录",
        "folder/sub",
        "folder/sub/结果 %.txt",
        "folder/root.bin",
      ].sort(),
    );
    expect(preview).toMatchObject({
      files: 2,
      directories: 3,
      totalBytes: 11,
      skipped: 0,
    });
    expect(f.remote.directoryHandles()).toBe(0);
    expect(f.retained()).toBe(0);
    const entry = preview.entries.find((e) => e.name === "结果 %.txt")!;
    const source = await f.trees.prepareEntry(
      actor,
      preview.id,
      entry.id,
      randomUUID(),
      "new-session",
    );
    expect((await f.downloads.chunk(actor, source.id, 0)).toString()).toBe(
      "content",
    );
    await f.downloads.cancel(actor, source.id);
    f.downloads.forget(actor, source.id);
    expect(f.retained()).toBe(0);
    expect(f.remote.writes()).toBe(0);
  });
  it("reports actual directory links without following their target", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    await f.remote.mkdir("/outside");
    await f.remote.write("/outside/secret", "not selected");
    await f.remote.symlinkDirectory("/folder/link", "/outside");
    const resolve = vi.spyOn(f.remote.io, "resolve");
    const preview = await f.scan();
    expect(preview).toMatchObject({ files: 0, directories: 1, skipped: 1 });
    expect(preview.entries.find((e) => e.name === "link")).toMatchObject({
      kind: "symlink",
      error: "DOWNLOAD_TREE_LINK_SKIPPED",
    });
    expect(resolve).not.toHaveBeenCalledWith("/folder/link");
    expect(preview.entries.some((e) => e.path.includes("secret"))).toBe(false);
  });
  it("rejects changed source attributes and changed server identity before reading file contents", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    await f.remote.write("/folder/file", "old");
    const preview = await f.scan(),
      entry = preview.entries.find((e) => e.kind === "file")!;
    await f.remote.write("/folder/file", "different");
    const inspect = vi.spyOn(f.remote.io, "inspectFile");
    await expect(
      f.trees.prepareEntry(
        actor,
        preview.id,
        entry.id,
        randomUUID(),
        "session",
      ),
    ).rejects.toThrow("DOWNLOAD_SOURCE_CHANGED");
    expect(inspect).not.toHaveBeenCalled();
    f.changePeer();
    const resolve = vi.spyOn(f.remote.io, "resolve");
    await expect(
      f.trees.prepareEntry(
        actor,
        preview.id,
        entry.id,
        randomUUID(),
        "new-session",
      ),
    ).rejects.toThrow("DOWNLOAD_HOST_IDENTITY_CHANGED");
    expect(resolve).not.toHaveBeenCalled();
    expect(f.retained()).toBe(0);
  });
  it("reports control-character names without interpreting or opening them", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    const meta = await f.remote.io.stat("/folder");
    vi.spyOn(f.remote.io, "list").mockResolvedValueOnce([
      { name: "line\nbreak", stat: { ...meta, kind: "file", size: 2 } },
    ]);
    const stat = vi.spyOn(f.remote.io, "stat");
    const preview = await f.scan();
    expect(preview.entries.find((e) => e.name === "line\nbreak")).toMatchObject(
      { error: "DOWNLOAD_TREE_NAME_UNSUPPORTED" },
    );
    expect(stat).not.toHaveBeenCalledWith("/folder/line\nbreak");
    expect(preview.skipped).toBe(1);
  });
  it("enforces depth and live-plan limits and admits scans after explicit release", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    const plans = [];
    for (let i = 0; i < 4; i++) plans.push(await f.scan());
    await expect(f.scan()).rejects.toThrow("DOWNLOAD_TREE_LIMIT");
    f.trees.forget(actor, plans[0].id);
    const replacement = await f.scan();
    f.trees.forget(actor, replacement.id);
    for (const plan of plans.slice(1)) f.trees.forget(actor, plan.id);
    const directoryStat = await f.remote.io.stat("/folder");
    vi.spyOn(f.remote.io, "stat").mockResolvedValue(directoryStat);
    vi.spyOn(f.remote.io, "resolve").mockImplementation(async (p) => p);
    vi.spyOn(f.remote.io, "list").mockResolvedValue([
      { name: "child", stat: directoryStat },
    ]);
    await expect(f.scan()).rejects.toThrow("DOWNLOAD_TREE_LIMIT");
    expect(f.retained()).toBe(0);
  });
  it("keeps recursive HTTP operations human-only and binds entry preparation to the stored preview", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    await f.remote.write("/folder/file", "payload");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        userId: req.headers["x-user"] ?? "owner",
        apiKeyId: req.headers["x-key"],
      });
      next();
    });
    registerDownloadTransferRoutes(app, f.downloads, f.trees);
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
    const body = JSON.stringify({ sessionId: "session", paths: ["/folder"] });
    expect(
      (
        await fetch(base + "/trees/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-key": "api" },
          body,
        })
      ).status,
    ).toBe(403);
    const response = await fetch(base + "/trees/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preview = await response.json(),
      entry = preview.entries.find((e: { kind: string }) => e.kind === "file");
    expect(
      (
        await fetch(base + "/trees/" + preview.id, {
          headers: { "x-user": "other" },
        })
      ).status,
    ).toBe(404);
    const route =
      base + "/trees/" + preview.id + "/entries/" + entry.id + "/prepare";
    expect(
      (
        await fetch(route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: randomUUID(),
            sessionId: "session",
            path: "/another",
          }),
        })
      ).status,
    ).toBe(409);
    const prepared = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), sessionId: "session" }),
    });
    expect(prepared.status).toBe(200);
    const source = await prepared.json();
    expect(source.canonicalPath).toBe("/folder/file");
    expect(
      await (await fetch(base + "/" + source.id + "/chunk?offset=0")).text(),
    ).toBe("payload");
  });
  it("isolates preview owners and revokes a forgotten plan", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder");
    const preview = await f.scan();
    expect(() => f.trees.get({ userId: "other" }, preview.id)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    expect(() => f.trees.forget({ userId: "other" }, preview.id)).toThrow(
      "DOWNLOAD_NOT_FOUND",
    );
    await expect(
      f.trees.prepareEntry(
        actor,
        preview.id,
        preview.entries[0].id,
        randomUUID(),
        "session",
      ),
    ).rejects.toThrow("DOWNLOAD_TREE_ENTRY_UNAVAILABLE");
    f.trees.forget(actor, preview.id);
    expect(() => f.trees.get(actor, preview.id)).toThrow("DOWNLOAD_NOT_FOUND");
  });
  it("cancels directory enumeration and does not publish a partial plan", async () => {
    const f = await fixture();
    await f.remote.mkdir("/folder/child");
    const stop = new AbortController(),
      original = f.remote.io.list.bind(f.remote.io);
    vi.spyOn(f.remote.io, "list").mockImplementation(async (...args) => {
      const value = await original(...args);
      stop.abort();
      return value;
    });
    await expect(
      f.trees.scan(
        { userId: "owner", signal: stop.signal },
        { sessionId: "session", paths: ["/folder"] },
      ),
    ).rejects.toThrow("DOWNLOAD_CANCELLED");
    expect(f.remote.directoryHandles()).toBe(0);
    expect(f.retained()).toBe(0);
    expect(f.ports.audit).not.toHaveBeenCalled();
  });
});
