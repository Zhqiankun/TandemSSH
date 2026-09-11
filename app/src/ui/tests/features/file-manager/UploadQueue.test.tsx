import type { UploadSource } from "@/types/upload-source";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { File as NativeFile } from "node:buffer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UploadQueue } from "@/features/file-manager/uploads/queue";
import { UploadQueuePanel } from "@/features/file-manager/uploads/UploadQueuePanel";
import { uploadApi, type UploadApiPort } from "@/api/file-upload-api";
import {
  UPLOAD_CHUNK_BYTES,
  type UploadView,
  type UploadManifest,
} from "@/types/file-upload";
import i18n from "@/i18n/i18n";
const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: () => http }));
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  await i18n.changeLanguage("zh-CN");
  http.post.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function file(bytes: Buffer) {
  return new NativeFile([Uint8Array.from(bytes)], "发布.bin", {
    lastModified: 100,
  }) as unknown as File;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
}
function fixture(
  options: {
    existing?: boolean;
    pause?: ReturnType<typeof deferred>;
    unknown?: boolean;
    blocked?: boolean;
  } = {},
) {
  const rows = new Map<
      string,
      { view: UploadView; manifest: UploadManifest; chunks: Buffer[] }
    >(),
    calls: string[] = [];
  const api: UploadApiPort = {
    prepare: vi.fn(async (input) => {
      const id = crypto.randomUUID(),
        view: UploadView = {
          id,
          path: input.path,
          canonicalPath: input.path,
          sessionId: input.sessionId,
          hostIdentity: "真实目标",
          name: input.manifest.name,
          totalBytes: input.manifest.size,
          receivedBytes: 0,
          chunkBytes: UPLOAD_CHUNK_BYTES,
          state: "preview",
          existing: options.existing
            ? { size: 2, mtime: 100, mode: 0o640 }
            : undefined,
          createdAt: Date.now(),
          expiresAt: Date.now() + 300000,
        };
      rows.set(id, { view, manifest: input.manifest, chunks: [] });
      return structuredClone(view);
    }),
    start: vi.fn(async (_session, id, input) => {
      calls.push("start");
      const r = rows.get(id)!;
      if (options.blocked && !input.takeover) {
        r.view.error = "FILE_AUTOMATION_ACTIVE";
        return structuredClone(r.view);
      }
      if (r.view.existing && !input.overwrite)
        throw Error("UPLOAD_OVERWRITE_REQUIRED");
      r.view.state = "uploading";
      r.view.error = undefined;
      r.view.temporaryPath = "/srv/.tandem-upload-owned";
      return structuredClone(r.view);
    }),
    chunk: vi.fn(async (_session, id, offset, blob) => {
      calls.push("chunk");
      const r = rows.get(id)!,
        bytes = Buffer.from(await blob.arrayBuffer());
      expect(offset).toBe(r.view.receivedBytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        r.manifest.hashes[r.chunks.length],
      );
      r.chunks.push(bytes);
      r.view.receivedBytes += bytes.length;
      if (options.pause && r.chunks.length === 1) await options.pause.promise;
      return structuredClone(r.view);
    }),
    action: vi.fn(async (_session, id, action) => {
      calls.push(action);
      const r = rows.get(id)!;
      if (action === "pause") r.view.state = "paused";
      if (action === "resume") r.view.state = "uploading";
      if (action === "finish") {
        r.view.state = "completed";
        r.view.temporaryPath = undefined;
        r.view.verification = "sha256";
        r.view.sha256 = createHash("sha256")
          .update(Buffer.concat(r.chunks))
          .digest("hex");
        if (options.unknown) throw Error("transport lost");
      }
      if (action === "cancel" && r.view.state !== "completed") {
        r.view.state = "cancelled";
        r.view.temporaryPath = undefined;
      }
      return structuredClone(r.view);
    }),
  };
  return { queue: new UploadQueue(api), api, rows, calls };
}
const add = (q: UploadQueue, bytes = Buffer.from("payload")) =>
  q.add({
    file: file(bytes),
    sessionId: "session",
    path: "/srv/发布.bin",
    hostId: 7,
    hostLabel: "所选主机",
  });
describe("actual upload queue controls", () => {
  it("accepts asynchronously read native sources without changing the transfer state machine", async () => {
    const f = fixture(),
      original = file(Buffer.from("native bytes")),
      verify = vi.fn(async () => {});
    const source: UploadSource = {
      name: original.name,
      size: original.size,
      lastModified: original.lastModified,
      verify,
      slice: async (start, end) => original.slice(start, end),
    };
    const id = f.queue.add({
      file: source,
      sessionId: "session",
      path: "/srv/native.bin",
      hostLabel: "fixture",
    });
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    expect(f.calls).toEqual([]);
    f.queue.start(id, false);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    expect(f.calls).toEqual(["start", "chunk", "finish", "forget"]);
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it("rechecks a zero-byte source before commit and refuses a source changed after review", async () => {
    const f = fixture(),
      verify = vi
        .fn(async () => {})
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Error("UPLOAD_SOURCE_CHANGED"));
    const source: UploadSource = {
      name: "empty",
      size: 0,
      lastModified: 100,
      verify,
      slice: async () => new Blob([]),
    };
    const id = f.queue.add({
      file: source,
      sessionId: "session",
      path: "/srv/empty",
      hostLabel: "fixture",
    });
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(id, false);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0]).toMatchObject({
        state: "failed",
        error: "UPLOAD_SOURCE_CHANGED",
      }),
    );
    expect(f.calls).not.toContain("finish");
    await f.queue.cancel(id);
  });

  it("shows Chinese target review and requires explicit overwrite before completing", async () => {
    const f = fixture({ existing: true }),
      id = add(f.queue),
      refresh = vi.fn();
    render(
      <UploadQueuePanel
        queue={f.queue}
        sessionId="session"
        hostId={7}
        onRefresh={refresh}
      />,
    );
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    expect(screen.getByText(/真实目标/)).toBeTruthy();
    const start = screen.getByRole("button", {
      name: "开始上传",
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(f.calls).toEqual([]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "我确认覆盖本次预览的现有文件" }),
    );
    fireEvent.click(start);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    expect(screen.getByText("内容校验通过")).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f.calls).toEqual(["start", "chunk", "finish", "forget"]);
    expect(f.queue.getSnapshot()[0].id).toBe(id);
  });
  it("pauses at a confirmed chunk boundary, rechecks the source and resumes the remaining bytes", async () => {
    const wait = deferred(),
      f = fixture({ pause: wait }),
      bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 7, 0x53),
      id = add(f.queue, bytes);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(id, false);
    await vi.waitFor(() => expect(f.api.chunk).toHaveBeenCalledTimes(1));
    f.queue.pause(id);
    expect(f.queue.getSnapshot()[0].state).toBe("pausing");
    wait.resolve();
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("paused"),
    );
    expect(f.api.chunk).toHaveBeenCalledTimes(1);
    f.queue.resume(id, "session");
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    expect(f.api.chunk).toHaveBeenCalledTimes(2);
    expect(f.calls).toEqual([
      "start",
      "chunk",
      "pause",
      "resume",
      "chunk",
      "finish",
      "forget",
    ]);
    expect(Buffer.concat([...f.rows.values()][0].chunks).equals(bytes)).toBe(
      true,
    );
  }, 15000);
  it("keeps a lost commit response unknown and never automatically repeats start or finish", async () => {
    const f = fixture({ unknown: true }),
      id = add(f.queue);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(id, false);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("unknown"),
    );
    f.queue.start(id, true);
    f.queue.resume(id, "session");
    await f.queue.cancel(id);
    expect(f.calls).toEqual(["start", "chunk", "finish"]);
  });
  it("offers explicit takeover and does not write until that choice is made", async () => {
    const f = fixture({ blocked: true }),
      id = add(f.queue);
    render(
      <UploadQueuePanel
        queue={f.queue}
        sessionId="session"
        hostId={7}
        onRefresh={() => {}}
      />,
    );
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(id, false);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].error).toBe("FILE_AUTOMATION_ACTIVE"),
    );
    expect(f.calls).toEqual(["start"]);
    fireEvent.click(screen.getByRole("button", { name: "接管并开始上传" }));
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    expect(f.api.start).toHaveBeenLastCalledWith(
      "session",
      expect.any(String),
      { overwrite: false, takeover: true },
      expect.any(AbortSignal),
    );
  });
  it("reports a known verification failure as failed, without turning it into an unknown commit", async () => {
    const f = fixture(),
      id = add(f.queue),
      base = f.api.action;
    f.api.action = vi.fn(
      async (
        ...args: Parameters<UploadApiPort["action"]>
      ): Promise<UploadView> =>
        args[2] === "finish"
          ? {
              ...[...f.rows.values()][0].view,
              state: "failed",
              error: "UPLOAD_CHECKPOINT_CHANGED",
              commitMayHaveOccurred: false,
            }
          : base(...args),
    );
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(id, false);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("failed"),
    );
    expect(f.queue.getSnapshot()[0].error).toBe("UPLOAD_CHECKPOINT_CHANGED");
  });
});
it("sends a raw binary chunk with query offset instead of the obsolete multipart shape", async () => {
  const blob = new Blob(["raw binary"]);
  http.post.mockResolvedValue({
    data: { state: "uploading", receivedBytes: 10 },
  });
  const result = await uploadApi.chunk("session", "id", 4194304, blob);
  expect(http.post).toHaveBeenCalledWith(
    "/ssh/uploads/id/chunk",
    blob,
    expect.objectContaining({
      params: { offset: 4194304 },
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
  expect(result.state).toBe("uploading");
  expect(http.post.mock.calls[0][1]).not.toBeInstanceOf(FormData);
});

it("drops local file references and visible jobs when the account changes", async () => {
  const f = fixture();
  f.queue.setOwner("alice");
  const id = add(f.queue);
  await vi.waitFor(() =>
    expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
  );
  f.queue.setOwner("bob");
  expect(f.queue.getSnapshot()).toEqual([]);
  expect(() => f.queue.start(id, true)).toThrow("UPLOAD_NOT_FOUND");
  expect(f.calls).not.toContain("chunk");
  expect(f.calls).not.toContain("finish");
});

it.each(["completed", "committing"] as const)(
  "keeps a concurrent %s result truthful when cancelling",
  async (state) => {
    const f = fixture(),
      id = add(f.queue);
    await vi.waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    const base = f.api.action;
    f.api.action = vi.fn(
      async (
        ...args: Parameters<UploadApiPort["action"]>
      ): Promise<UploadView> =>
        args[2] === "cancel"
          ? {
              ...[...f.rows.values()][0].view,
              state,
              receivedBytes: 7,
              verification: state === "completed" ? "sha256" : undefined,
              sha256: "a".repeat(64),
            }
          : base(...args),
    );
    await f.queue.cancel(id);
    expect(f.queue.getSnapshot()[0].state).toBe(
      state === "completed" ? "completed" : "unknown",
    );
  },
);
it("honors concurrency and continues queued files after one preparation fails", async () => {
  const f = fixture(),
    first = deferred(),
    second = deferred();
  const original = vi.mocked(f.api.prepare).getMockImplementation()!;
  let active = 0,
    peak = 0,
    started = 0;
  vi.mocked(f.api.prepare).mockImplementation(async (...args) => {
    const index = started++;
    active++;
    peak = Math.max(peak, active);
    try {
      if (index === 0) {
        await first.promise;
        throw Error("UPLOAD_PERMISSION_DENIED");
      }
      if (index === 1) await second.promise;
      return await original(...args);
    } finally {
      active--;
    }
  });
  f.queue.setConcurrency(2);
  const ids = [0, 1, 2].map((index) =>
    f.queue.add({
      file: file(Buffer.from("payload-" + index)),
      sessionId: "session",
      path: "/srv/file-" + index,
      hostLabel: "fixture",
    }),
  );
  await vi.waitFor(() => expect(started).toBe(2));
  expect(f.queue.getSnapshot()[2].state).toBe("queued");
  expect(active).toBe(2);
  first.resolve();
  await vi.waitFor(() => expect(started).toBe(3));
  expect(f.queue.getSnapshot()[0].state).toBe("failed");
  second.resolve();
  await vi.waitFor(() =>
    expect(
      f.queue
        .getSnapshot()
        .slice(1)
        .every((job) => job.state === "awaiting-review"),
    ).toBe(true),
  );
  for (const id of ids.slice(1)) f.queue.start(id, false);
  await vi.waitFor(() =>
    expect(f.queue.getSnapshot().map((job) => job.state)).toEqual([
      "failed",
      "completed",
      "completed",
    ]),
  );
  expect(peak).toBe(2);
  expect(f.queue.getSnapshot().map((job) => job.path)).toEqual([
    "/srv/file-0",
    "/srv/file-1",
    "/srv/file-2",
  ]);
});
