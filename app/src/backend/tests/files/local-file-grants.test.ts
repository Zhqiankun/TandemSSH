import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import {
  LocalFileGrants,
  type LocalTaskIdentity,
  type NativeTaskLocalFiles,
} from "../../files/local-file-grants";
import { localFileGrantRoutes } from "../../files/local-file-routes";
import type { FileTransferAction } from "../../../types/file-transfer";
import type { DownloadSource } from "../../../types/file-download";
const require = createRequire(import.meta.url),
  { TaskLocalFiles } = require("../../../../electron/task-local-files.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "local-file-grants-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("local-file-grants-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const source = path.join(folder, "产物 %.bin"),
    target = path.join(folder, "结果.bin");
  await fs.writeFile(source, Buffer.from([0, 1, 255]));
  const ctx: LocalTaskIdentity = {
    userId: "owner",
    taskId: randomUUID(),
    sessionId: randomUUID(),
    hostId: 1,
    hostName: "fixture",
    title: "本地授权测试",
    state: "awaiting-authorization",
    control: { generation: 1, controlEpoch: 0 },
  };
  const native: NativeTaskLocalFiles = new TaskLocalFiles(),
    audit = vi.fn(async () => {});
  const context = (user: string, task: string) => {
    if (user !== ctx.userId || task !== ctx.taskId)
      throw Error("TASK_NOT_FOUND");
    return structuredClone(ctx);
  };
  const service = new LocalFileGrants({
      native: () => native,
      available: () => true,
      context,
      audit,
    }),
    token = randomUUID();
  service.bindWindow(token);
  cleanup.push(() => service.dispose());
  const choose = async (
    direction: "upload" | "download",
    allowOverwrite = false,
    paths = direction === "upload" ? [source] : [target],
  ) => {
    const ticket = service.issue(ctx.userId, ctx.taskId, {
      windowToken: token,
      direction,
      allowOverwrite,
    });
    service.claim(token, ticket.id);
    return {
      ticket,
      grants: (await service.fulfill(token, ticket.id, paths)).grants,
    };
  };
  return {
    folder,
    source,
    target,
    ctx,
    native,
    audit,
    context,
    service,
    token,
    choose,
  };
}
const action = (
  grant: { id: string; version: string; direction: "upload" | "download" },
  overwrite = false,
): FileTransferAction => ({
  type: grant.direction === "upload" ? "file.upload" : "file.download",
  localGrantId: grant.id,
  localVersion: grant.version,
  path: "/srv/output",
  overwrite,
});
const sourceSpec = (bytes: Buffer): DownloadSource => ({
  id: randomUUID(),
  sessionId: "session",
  path: "/srv/output",
  canonicalPath: "/srv/output",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  hashes: bytes.length
    ? [createHash("sha256").update(bytes).digest("hex")]
    : [],
  chunkBytes: 4194304,
  state: "ready",
  expiresAt: Date.now() + 60000,
});
it("requires a single-use native claim and binds the resulting source to its task and version", async () => {
  const f = await fixture(),
    ticket = f.service.issue("owner", f.ctx.taskId, {
      windowToken: f.token,
      direction: "upload",
    });
  await expect(
    f.service.fulfill(f.token, ticket.id, [f.source]),
  ).rejects.toThrow("FILE_LOCAL_TICKET_USED");
  f.service.claim(f.token, ticket.id);
  expect(() => f.service.claim(f.token, ticket.id)).toThrow(
    "FILE_LOCAL_TICKET_USED",
  );
  const grant = (await f.service.fulfill(f.token, ticket.id, [f.source]))
    .grants[0];
  await expect(
    f.service.fulfill(f.token, ticket.id, [f.source]),
  ).rejects.toThrow("FILE_LOCAL_TICKET_INVALID");
  expect(JSON.stringify(f.service.list("owner", f.ctx.taskId))).not.toContain(
    f.source,
  );
  expect(f.service.humanList("owner", f.ctx.taskId)[0].path).toBe(f.source);
  expect(() =>
    f.service.assert({ ...f.ctx, userId: "other" }, action(grant)),
  ).toThrow("FILE_LOCAL_GRANT_NOT_FOUND");
  expect(() =>
    f.service.assert(f.ctx, { ...action(grant), localVersion: randomUUID() }),
  ).toThrow("FILE_LOCAL_GRANT_REQUIRED");
  const local = await f.service.upload(
    f.ctx,
    action(grant),
    () => {},
    new AbortController().signal,
  );
  expect(await local.read(0, 3)).toEqual(Buffer.from([0, 1, 255]));
  await local.close();
});
it("does not widen a selected source when its file changes", async () => {
  const f = await fixture(),
    grant = (await f.choose("upload")).grants[0];
  await fs.writeFile(f.source, "changed");
  await expect(
    f.service.upload(
      f.ctx,
      action(grant),
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("UPLOAD_SOURCE_CHANGED");
});
it("retains the chosen destination baseline and requires explicit overwrite permission", async () => {
  const f = await fixture();
  await fs.writeFile(f.target, "old");
  const grant = (await f.choose("download", false)).grants[0],
    bytes = Buffer.from("new");
  expect(() => f.service.assert(f.ctx, action(grant, true))).toThrow(
    "FILE_LOCAL_OVERWRITE_REQUIRED",
  );
  await f.service.forget("owner", f.ctx.taskId, grant.id);
  expect(await fs.readFile(f.target, "utf8")).toBe("old");
  const next = (await f.choose("download", true)).grants[0];
  await fs.writeFile(f.target, "external change");
  await expect(
    f.service.download(
      f.ctx,
      action(next, true),
      sourceSpec(bytes),
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("DOWNLOAD_TARGET_CHANGED");
  expect(await fs.readFile(f.target, "utf8")).toBe("external change");
});
it("writes and verifies a selected destination, then retires the one-use target without deleting it", async () => {
  const f = await fixture(),
    grant = (await f.choose("download")).grants[0],
    bytes = Buffer.from([9, 0, 255]);
  const local = await f.service.download(
    f.ctx,
    action(grant),
    sourceSpec(bytes),
    () => {},
    new AbortController().signal,
  );
  await local.start(false);
  await local.append(0, bytes);
  expect((await local.finish()).sha256).toBe(sourceSpec(bytes).sha256);
  await local.close();
  expect(f.service.list("owner", f.ctx.taskId)[0].state).toBe("consumed");
  expect(() => f.service.assert(f.ctx, action(grant))).toThrow(
    "FILE_LOCAL_GRANT_CONSUMED",
  );
  await f.service.forget("owner", f.ctx.taskId, grant.id);
  expect(await fs.readFile(f.target)).toEqual(bytes);
});
it.each(["window", "generation", "ended"])(
  "revokes active sources on %s changes",
  async (mode) => {
    const f = await fixture(),
      grant = (await f.choose("upload")).grants[0];
    const local = await f.service.upload(
      f.ctx,
      action(grant),
      () => {},
      new AbortController().signal,
    );
    if (mode === "window") f.service.closeWindow(f.token);
    if (mode === "generation") f.ctx.control.generation++;
    if (mode === "ended") f.ctx.state = "completed";
    await expect(local.read(0, 3)).rejects.toThrow();
    await local.close();
    expect(f.service.list("owner", f.ctx.taskId)[0].state).toBe("revoked");
  },
);
it("cancels a pending native selection after a window reset, without creating grants", async () => {
  const f = await fixture(),
    ticket = f.service.issue("owner", f.ctx.taskId, {
      windowToken: f.token,
      direction: "upload",
    });
  f.service.claim(f.token, ticket.id);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    original = f.native.select.bind(f.native);
  vi.spyOn(f.native, "select").mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const work = f.service.fulfill(f.token, ticket.id, [f.source]);
  f.service.closeWindow(f.token);
  release();
  await expect(work).rejects.toThrow("FILE_LOCAL_TICKET_INVALID");
  expect(f.service.list("owner", f.ctx.taskId)).toEqual([]);
});
it("does not publish grants if the required audit fails", async () => {
  const f = await fixture();
  f.audit.mockRejectedValue(Error("AUDIT_UNAVAILABLE"));
  await expect(f.choose("upload")).rejects.toThrow("AUDIT_UNAVAILABLE");
  expect(f.service.list("owner", f.ctx.taskId)).toEqual([]);
});
it("rejects API keys, foreign tasks, and raw path injection at the HTTP ticket boundary", async () => {
  const f = await fixture(),
    app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      userId: req.headers["x-user"] ?? "owner",
      apiKeyId: req.headers["x-api-key"],
    });
    next();
  });
  app.use(
    localFileGrantRoutes(f.service, (u, t) => {
      f.context(u, t);
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const url =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/tasks/" +
    f.ctx.taskId;
  expect((await fetch(url, { headers: { "x-api-key": "key" } })).status).toBe(
    403,
  );
  expect((await fetch(url, { headers: { "x-user": "other" } })).status).toBe(
    404,
  );
  const invalid = await fetch(url + "/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      windowToken: f.token,
      direction: "upload",
      paths: [f.source],
    }),
  });
  expect(invalid.status).toBe(409);
  const valid = await fetch(url + "/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ windowToken: f.token, direction: "upload" }),
  });
  expect(valid.status).toBe(200);
  expect(valid.headers.get("cache-control")).toBe("no-store");
});

it("reserves per-user capacity across concurrent native selections", async () => {
  const f = await fixture();
  const paths = Array.from({ length: 32 }, (_, i) =>
    path.join(f.folder, "file-" + i),
  );
  await Promise.all(paths.map((p) => fs.writeFile(p, "x")));
  const first = f.service.issue("owner", f.ctx.taskId, {
      windowToken: f.token,
      direction: "upload",
    }),
    second = f.service.issue("owner", f.ctx.taskId, {
      windowToken: f.token,
      direction: "upload",
    });
  f.service.claim(f.token, first.id);
  f.service.claim(f.token, second.id);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    original = f.native.select.bind(f.native);
  vi.spyOn(f.native, "select").mockImplementationOnce(async (...args) => {
    await gate;
    return original(...args);
  });
  const pending = f.service.fulfill(f.token, first.id, paths);
  await expect(
    f.service.fulfill(f.token, second.id, [f.source]),
  ).rejects.toThrow("FILE_LOCAL_GRANT_LIMIT");
  release();
  expect((await pending).grants).toHaveLength(32);
});
