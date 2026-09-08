import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import {
  AutomatedTransfers,
  type TaskLocalTransferPort,
  type AutomatedTransferPorts,
} from "../../files/automated-transfers";
import {
  OperationGateway,
  type OperationContext,
} from "../../collaboration/operations/gateway";
import { SessionControl } from "../../collaboration/sessions/control";
import {
  validateFileAction,
  evaluateFilePolicy,
  fileScopeAllows,
} from "../../collaboration/policies/file-policy";
import { validateFileResult } from "../../collaboration/operations/file-result";
import { FilePathLocks } from "../../files/path-locks";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import type { NativeUploadSelection } from "../../../types/upload-source";
import type { FileTransferAction } from "../../../types/file-transfer";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations";
import { UPLOAD_CHUNK_BYTES } from "../../../types/file-upload";
const require = createRequire(import.meta.url);
const {
    UploadSourceStore,
  } = require("../../../../electron/upload-sources.cjs"),
  { DownloadSink } = require("../../../../electron/download-sink.cjs");
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};
async function fixture(
  mode: OperationContext["mode"] = "automatic",
  large = false,
  empty = false,
) {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  await remote.mkdir("/srv");
  const cache = await fs.realpath(path.resolve(process.cwd(), "../.cache")),
    folder = await fs.mkdtemp(path.join(cache, "automated-transfer-"));
  cleanup.push(async () => {
    const actual = await fs.realpath(folder);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("automated-transfer-")
    )
      throw Error("Cleanup scope");
    await fs.rm(actual, { recursive: true, force: true });
  });
  const bytes = large
      ? Buffer.alloc(UPLOAD_CHUNK_BYTES + 17, 0x8a)
      : empty
        ? Buffer.alloc(0)
        : Buffer.from([0, 255, 128, 3, 4]),
    localPath = path.join(folder, "产物.bin"),
    destination = path.join(folder, "结果.bin");
  await fs.writeFile(localPath, bytes);
  const store = new UploadSourceStore(),
    sink = new DownloadSink();
  cleanup.push(
    () => store.reset(1),
    () => sink.reset(1),
  );
  const selection: NativeUploadSelection = await store.select(1, [localPath]),
    entry = selection.entries[0];
  const uploadGrant = randomUUID(),
    downloadGrant = randomUUID(),
    version = randomUUID(),
    taskId = randomUUID(),
    writes: string[] = [],
    events: unknown[] = [];
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: (data) => writes.push(Buffer.from(data).toString()),
    },
    () => {},
  );
  const lease = control.grant(
    { kind: "automation", ownerType: "agent-task", ownerId: taskId },
    control.snapshot(),
  );
  const local: TaskLocalTransferPort = {
    assert: vi.fn((ctx, action) => {
      if (
        ctx.userId !== "owner" ||
        ctx.taskId !== taskId ||
        ctx.sessionId !== "session" ||
        action.localVersion !== version ||
        action.localGrantId !==
          (action.type === "file.upload" ? uploadGrant : downloadGrant)
      )
        throw Error("FILE_LOCAL_GRANT_REQUIRED");
    }),
    upload: async (ctx, action, guard) => {
      local.assert(ctx, action);
      guard();
      await store.check(1, selection.id, entry.id, guard);
      const hashes: string[] = [];
      for (let offset = 0; offset < entry.size; offset += UPLOAD_CHUNK_BYTES) {
        guard();
        const chunk = await store.chunk(
          1,
          selection.id,
          entry.id,
          offset,
          Math.min(UPLOAD_CHUNK_BYTES, entry.size - offset),
          guard,
        );
        hashes.push(createHash("sha256").update(chunk).digest("hex"));
      }
      return {
        manifest: {
          name: entry.name,
          size: entry.size,
          lastModified: entry.lastModified,
          hashes,
        },
        read: async (offset, length) =>
          Buffer.from(
            await store.chunk(1, selection.id, entry.id, offset, length, guard),
          ),
        verify: async () => {
          await store.check(1, selection.id, entry.id, guard);
        },
        close: () => {},
      };
    },
    download: async (ctx, action, source, guard) => {
      local.assert(ctx, action);
      guard();
      const selected = await sink.choose(
        1,
        {
          name: "结果.bin",
          size: source.size,
          sha256: source.sha256,
          hashes: source.hashes,
        },
        async () => destination,
        undefined,
        guard,
      );
      return {
        snapshot: () => sink.view(sink.owned(1, selected.id)),
        start: (overwrite) => sink.start(1, selected.id, overwrite),
        append: (offset, chunk) => sink.append(1, selected.id, offset, chunk),
        finish: () => sink.finish(1, selected.id),
        close: async () => {
          const r = sink.owned(1, selected.id);
          if (r.handle) {
            await r.handle.close();
            r.handle = undefined;
          }
        },
      };
    },
  };
  const ports: AutomatedTransferPorts = {
    local,
    locks: new FilePathLocks(),
    audit: async (_ctx, type, data) => {
      events.push({ type, data });
    },
    open: vi.fn(async (_ctx, guard) => ({
      target: {
        key: "fixture",
        connection: "session",
        io: remote.io,
        acceptedHostKey: remote.peerKey(),
        check: (_a, _p, canonical) => guard(canonical),
      },
      close: () => {},
      beginWrite: () => () => {},
    })),
  };
  const transfers = new AutomatedTransfers(ports);
  cleanup.push(() => transfers.dispose());
  const policy: CommandPolicySnapshot = { revision: 1, sets: [] };
  const gateway = new OperationGateway(
    control,
    { hostId: "1", groupIds: [] },
    () => policy,
    {
      prepare: async () => ({
        bytes: Buffer.from("pwd"),
        completion: Promise.resolve({ exitCode: 0, output: "/srv" }),
        dispose: () => {},
      }),
    },
    {
      append: async (e) => {
        events.push(e);
      },
    },
    Date.now,
    undefined,
    transfers.executor("owner", "session"),
  );
  gateway.authorizeTask(taskId, lease, {
    matches: [{ kind: "program", program: "pwd" }],
    fileScopes: [
      { kind: "directory", path: "/srv", access: ["read", "write"] },
    ],
    cwdScopes: ["/srv"],
    maxOperations: 3,
    expiresAt: Date.now() + 60000,
    expectedPolicyRevision: 1,
  });
  const context = (requestId = randomUUID()): OperationContext => ({
    taskId,
    requestId,
    mode,
    origin: "mcp",
    lease,
  });
  const action = (
    direction: "upload" | "download",
    overwrite = false,
  ): FileTransferAction => ({
    type: direction === "upload" ? "file.upload" : "file.download",
    path: "/srv/产物.bin",
    localGrantId: direction === "upload" ? uploadGrant : downloadGrant,
    localVersion: version,
    overwrite,
  });
  const run = async (a: FileTransferAction) => {
    const op = await gateway.propose(context(), a);
    if (mode === "collaborative") gateway.approveOnce(op.id, op.digest, 1);
    return gateway.dispatch(op.id);
  };
  return {
    remote,
    localPath,
    destination,
    bytes,
    transfers,
    ports,
    local,
    control,
    lease,
    gateway,
    context,
    action,
    run,
    policy,
    writes,
    events,
  };
}
describe("binary transfers through the shared operation gateway", () => {
  it.each(["automatic", "collaborative"] as const)(
    "round-trips exact binary content in %s mode and shares the command budget",
    async (mode) => {
      const f = await fixture(mode);
      const upload = await f.run(f.action("upload"));
      expect(upload.status, upload.error).toBe("succeeded");
      expect(await f.remote.read("/srv/产物.bin")).toEqual(f.bytes);
      const command = await f.gateway.propose(f.context(), {
        type: "terminal.command",
        program: "pwd",
        args: [],
        cwd: "/srv",
      });
      if (mode === "collaborative")
        f.gateway.approveOnce(command.id, command.digest, 1);
      expect((await f.gateway.dispatch(command.id)).status).toBe("succeeded");
      const download = await f.run(f.action("download"));
      expect(download.status, download.error).toBe("succeeded");
      expect(await fs.readFile(f.destination)).toEqual(f.bytes);
      expect(download.fileResult?.transfer).toMatchObject({
        bytes: f.bytes.length,
        totalBytes: f.bytes.length,
        verification: "sha256",
        cleanupRequired: false,
      });
      expect(f.writes).toEqual(["pwd"]);
      const extra = await f.gateway.propose(f.context(), f.action("download"));
      await expect(f.gateway.dispatch(extra.id)).rejects.toThrow(
        "FILE_SCOPE_REQUIRED",
      );
      expect(JSON.stringify(f.events)).not.toContain(f.localPath);
    },
    30000,
  );
  it("waits for collaborative approval before opening SSH or reading local bytes", async () => {
    const f = await fixture("collaborative"),
      op = await f.gateway.propose(f.context(), f.action("upload"));
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    expect(f.ports.open).not.toHaveBeenCalled();
    expect(f.local.assert).not.toHaveBeenCalled();
    f.gateway.approveOnce(op.id, op.digest, 1);
    expect((await f.gateway.dispatch(op.id)).status).toBe("succeeded");
  }, 30000);
  it("rejects a foreign local capability before opening the SSH channel", async () => {
    const f = await fixture();
    const result = await f.run({
      ...f.action("upload"),
      localGrantId: randomUUID(),
    });
    expect(result.error).toBe("FILE_LOCAL_GRANT_REQUIRED");
    expect(f.ports.open).not.toHaveBeenCalled();
  }, 30000);
  it("takes over while a source block is in flight and never sends the late block", async () => {
    const f = await fixture("automatic", true),
      entered = deferred(),
      release = deferred(),
      original = f.local.upload;
    vi.spyOn(f.local, "upload").mockImplementation(async (...args) => {
      const source = await original(...args);
      return {
        ...source,
        read: async (...range) => {
          const bytes = await source.read(...range);
          entered.resolve();
          await release.promise;
          return bytes;
        },
      };
    });
    const op = await f.gateway.propose(f.context(), f.action("upload")),
      pending = f.gateway.dispatch(op.id);
    await entered.promise;
    f.control.takeover();
    release.resolve();
    const result = await pending;
    expect(result.status).toBe("unknown");
    expect(f.remote.writes()).toBe(0);
    expect(await f.remote.read("/srv/产物.bin").catch(() => null)).toBeNull();
  }, 30000);
  it("rechecks local authority at final download commit and preserves an existing destination", async () => {
    const f = await fixture(),
      entered = deferred(),
      release = deferred();
    await f.remote.write("/srv/产物.bin", f.bytes);
    await fs.writeFile(f.destination, "old local bytes");
    const original = f.local.download;
    vi.spyOn(f.local, "download").mockImplementation(async (...args) => {
      const destination = await original(...args);
      return {
        ...destination,
        finish: async () => {
          entered.resolve();
          await release.promise;
          return destination.finish();
        },
      };
    });
    const op = await f.gateway.propose(f.context(), f.action("download", true)),
      pending = f.gateway.dispatch(op.id);
    await entered.promise;
    f.control.takeover();
    release.resolve();
    const result = await pending;
    expect(result.status).toBe("unknown");
    expect(await fs.readFile(f.destination, "utf8")).toBe("old local bytes");
    expect(result.fileResult?.transfer?.cleanupRequired).toBe(true);
  }, 30000);
  it("does not repeat a remote commit after an unverified replacement result", async () => {
    const f = await fixture();
    const original = f.remote.io.replace.bind(f.remote.io);
    const replace = vi
      .spyOn(f.remote.io, "replace")
      .mockImplementation(async (...args) => {
        await original(...args);
        throw Error("lost verification");
      });
    const op = await f.gateway.propose(f.context("same"), f.action("upload")),
      result = await f.gateway.dispatch(op.id);
    expect(result.status).toBe("unknown");
    expect(await f.remote.read("/srv/产物.bin")).toEqual(f.bytes);
    await f.gateway.dispatch(op.id);
    expect(replace).toHaveBeenCalledTimes(1);
  }, 30000);
  it("returns a known source-change failure without publishing file content", async () => {
    const f = await fixture();
    await fs.writeFile(f.localPath, "source changed");
    const result = await f.run(f.action("upload"));
    expect(result.status).toBe("failed");
    expect(result.error).toBe("UPLOAD_SOURCE_CHANGED");
    expect(f.remote.writes()).toBe(0);
    expect(JSON.stringify(f.events)).not.toContain("source changed");
  }, 30000);
});
it("treats upload as remote write and download as read; rejects raw local paths and false success", () => {
  const action: FileTransferAction = {
    type: "file.upload",
    path: "/srv/file",
    localGrantId: randomUUID(),
    localVersion: randomUUID(),
    overwrite: false,
  };
  const read = [
    { kind: "directory" as const, path: "/srv", access: ["read" as const] },
  ];
  expect(fileScopeAllows(read, action)).toBe(false);
  expect(fileScopeAllows(read, { ...action, type: "file.download" })).toBe(
    true,
  );
  expect(() =>
    validateFileAction({
      ...action,
      localPath: "C:/private",
    } as FileTransferAction),
  ).toThrow("INVALID_FILE_ACTION");
  const policy: CommandPolicySnapshot = {
    revision: 1,
    sets: [
      {
        id: "global",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: [],
        fileRules: [
          {
            id: "deny",
            effect: "deny",
            match: { kind: "path", path: "/srv/file", access: ["write"] },
            reason: "blocked",
          },
        ],
      },
    ],
  };
  expect(
    evaluateFilePolicy(policy, { hostId: "1", groupIds: [] }, action).outcome,
  ).toBe("deny");
  expect(() =>
    validateFileResult(
      { status: "succeeded", result: { bytes: 1 } },
      action,
      "/srv/file",
    ),
  ).toThrow("INVALID_FILE_RESULT");
  const transfer = {
    direction: "upload",
    localGrantId: action.localGrantId,
    localVersion: action.localVersion,
    transferId: randomUUID(),
    bytes: 1,
    totalBytes: 2,
    verification: "sha256",
    sha256: "a".repeat(64),
    cleanupRequired: false,
  };
  expect(() =>
    validateFileResult(
      { status: "succeeded", result: { transfer } },
      action,
      "/srv/file",
    ),
  ).toThrow("INVALID_FILE_RESULT");
});

it.each([false, true])(
  "round-trips a %s multi-block source without changing bytes",
  async (large) => {
    const f = await fixture("automatic", large, !large);
    const up = await f.run(f.action("upload")),
      down = await f.run(f.action("download"));
    expect(up.status, up.error).toBe("succeeded");
    expect(down.status, down.error).toBe("succeeded");
    expect(await fs.readFile(f.destination)).toEqual(f.bytes);
    const context = {
      userId: "owner",
      taskId: f.context().taskId,
      sessionId: "session",
      control: {
        generation: f.lease.generation,
        controlEpoch: f.lease.controlEpoch,
      },
    };
    expect(f.transfers.progress(context, down.id).result?.verification).toBe(
      "sha256",
    );
    expect(() =>
      f.transfers.progress({ ...context, userId: "other" }, down.id),
    ).toThrow("FILE_TRANSFER_NOT_FOUND");
    f.transfers.forget(context, down.id);
    expect(() => f.transfers.progress(context, down.id)).toThrow(
      "FILE_TRANSFER_NOT_FOUND",
    );
  },
  30000,
);
