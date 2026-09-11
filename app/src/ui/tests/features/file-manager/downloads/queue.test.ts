import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type {
  DesktopDownloadApi,
  DownloadSource,
  LocalDownloadView,
} from "@/types/file-download";
import type { DownloadApiPort } from "@/api/file-download-api";
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { DownloadQueue } from "../../../../features/file-manager/downloads/queue";
const digest = "a".repeat(64);
function fixture(unknownCommit = false) {
  const source: DownloadSource = {
    id: "source",
    sessionId: "session",
    path: "/result",
    canonicalPath: "/result",
    size: 4,
    sha256: digest,
    hashes: [digest],
    chunkBytes: 4194304,
    state: "ready",
    expiresAt: Date.now() + 60000,
  };
  const local: LocalDownloadView = {
    id: "local",
    path: "C:/chosen/result",
    size: 4,
    writtenBytes: 0,
    state: "preview",
  };
  const api: DownloadApiPort = {
    prepare: vi.fn(async () => source),
    chunk: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    action: vi.fn(async (_session, _id, action): Promise<DownloadSource> => ({
      ...source,
      state:
        action === "verify"
          ? "verified"
          : action === "cancel"
            ? "cancelled"
            : "ready",
    })),
  };
  let finish!: () => void;
  const ending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const native: DesktopDownloadApi = {
    reset: vi.fn(async () => ({ ok: true as const, value: null })),
    choose: vi.fn(async () => ({ ok: true as const, value: { ...local } })),
    start: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...local,
        state: "writing" as const,
        temporaryPath: "C:/chosen/.part",
      },
    })),
    append: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...local,
        state: "writing" as const,
        writtenBytes: 4,
        temporaryPath: "C:/chosen/.part",
      },
    })),
    action: vi.fn(async (_id, action) => {
      if (action === "finish") {
        await ending;
        return unknownCommit
          ? { ok: false as const, error: "DOWNLOAD_RESULT_UNVERIFIED" }
          : {
              ok: true as const,
              value: {
                ...local,
                state: "completed" as const,
                writtenBytes: 4,
                sha256: digest,
              },
            };
      }
      return {
        ok: true as const,
        value: { ...local, state: "cancelled" as const },
      };
    }),
  };
  const queue = new DownloadQueue(api, () => native);
  queue.setOwner("owner");
  const id = queue.add({
    sessionId: "session",
    path: "/result",
    name: "result",
    hostLabel: "host",
  });
  return { queue, id, native, api, finish };
}
describe("desktop download queue", () => {
  it("waits for destination review and native final verification before reporting completion", async () => {
    const f = fixture();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    expect(f.native.start).not.toHaveBeenCalled();
    f.queue.start(f.id, false);
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("finalizing"),
    );
    expect(f.queue.getSnapshot()[0].writtenBytes).toBe(4);
    f.finish();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    expect(f.queue.getSnapshot()[0].local?.sha256).toBe(digest);
    f.queue.setOwner(null);
  });
  it("clears native and server records only after their release is acknowledged", async () => {
    const f = fixture();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(f.id, false);
    f.finish();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    let acknowledge!: () => void;
    const released = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const original = f.native.action;
    f.native.action = vi.fn(async (id, action) => {
      if (action === "forget") await released;
      return original(id, action);
    });
    const pending = f.queue.clearFinished();
    await waitFor(() =>
      expect(f.native.action).toHaveBeenCalledWith("local", "forget"),
    );
    expect(f.queue.getSnapshot()).toHaveLength(1);
    acknowledge();
    await pending;
    expect(f.api.action).toHaveBeenCalledWith("session", "source", "forget");
    expect(f.queue.getSnapshot()).toEqual([]);
    f.queue.setOwner(null);
  });
  it("keeps a visible completed record when native release fails so it can be retried", async () => {
    const f = fixture();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(f.id, false);
    f.finish();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    const original = f.native.action;
    f.native.action = vi.fn(async (id, action) =>
      action === "forget"
        ? { ok: false as const, error: "DOWNLOAD_BUSY" }
        : original(id, action),
    );
    await f.queue.clearFinished();
    expect(f.queue.getSnapshot()[0]).toMatchObject({
      state: "completed",
      error: "DOWNLOAD_BUSY",
    });
    f.native.action = original;
    await f.queue.clearFinished();
    expect(f.queue.getSnapshot()).toEqual([]);
    f.queue.setOwner(null);
  });

  it("releases the old cancelled preview before retrying and asks for destination review again", async () => {
    const f = fixture();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    vi.mocked(f.native.start).mockRejectedValueOnce(Error("DOWNLOAD_FAILED"));
    f.queue.start(f.id, false);
    await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("failed"));
    await f.queue.retry(f.id);
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    expect(f.api.action).toHaveBeenCalledWith("session", "source", "forget");
    expect(f.native.action).toHaveBeenCalledWith("local", "forget");
    expect(f.native.choose).toHaveBeenCalledTimes(2);
    expect(f.native.start).toHaveBeenCalledTimes(1);
    f.queue.setOwner(null);
  });
  it("does not release a native capability in a new account lifetime after a delayed remote reply", async () => {
    const f = fixture();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(f.id, false);
    f.finish();
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("completed"),
    );
    let reply!: () => void;
    const response = new Promise<void>((resolve) => {
      reply = resolve;
    });
    const original = f.api.action;
    f.api.action = vi.fn(
      async (...args: Parameters<DownloadApiPort["action"]>) => {
        if (args[2] === "forget") await response;
        return original(...args);
      },
    );
    const clearing = f.queue.clearFinished();
    f.queue.setOwner("next-owner");
    reply();
    await clearing;
    expect(f.native.action).not.toHaveBeenCalledWith("local", "forget");
    expect(f.queue.getSnapshot()).toEqual([]);
    f.queue.setOwner(null);
  });
  it("preserves an uncertain commit and does not re-run an overwrite", async () => {
    const f = fixture(true);
    await waitFor(() =>
      expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"),
    );
    f.queue.start(f.id, false);
    f.finish();
    await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("unknown"));
    await f.queue.retry(f.id);
    f.queue.resume(f.id);
    await f.queue.cancel(f.id);
    await f.queue.clearFinished();
    expect(f.native.action).not.toHaveBeenCalledWith("local", "forget");
    expect(f.queue.getSnapshot()[0].state).toBe("unknown");
    expect(f.api.chunk).toHaveBeenCalledOnce();
    f.queue.setOwner(null);
  });
});
it("releases a failed preparation slot without dropping the remaining download jobs", async () => {
  const f = fixture();
  const original = vi.mocked(f.api.prepare).getMockImplementation()!;
  let releaseFirst!: () => void, releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const second = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let active = 0,
    peak = 0,
    started = 0;
  vi.mocked(f.api.prepare).mockImplementation(async (...args) => {
    const index = started++;
    active++;
    peak = Math.max(peak, active);
    try {
      if (index === 0) {
        await first;
        throw Error("DOWNLOAD_SOURCE_UNAVAILABLE");
      }
      if (index === 1) await second;
      const source = await original(...args);
      return {
        ...source,
        id: "source-" + index,
        path: args[0].path,
        canonicalPath: args[0].path,
      };
    } finally {
      active--;
    }
  });
  f.queue.setConcurrency(2);
  for (const name of ["second", "third"])
    f.queue.add({
      sessionId: "session",
      path: "/" + name,
      name,
      hostLabel: "host",
    });
  try {
    await waitFor(() => expect(started).toBe(2));
    expect(f.queue.getSnapshot()[2].state).toBe("queued");
    releaseFirst();
    await waitFor(() => expect(started).toBe(3));
    releaseSecond();
    await waitFor(() =>
      expect(f.queue.getSnapshot().map((job) => job.state)).toEqual([
        "failed",
        "awaiting-review",
        "awaiting-review",
      ]),
    );
    expect(peak).toBe(2);
    expect(f.queue.getSnapshot().map((job) => job.path)).toEqual([
      "/result",
      "/second",
      "/third",
    ]);
    expect(f.native.start).not.toHaveBeenCalled();
    expect(f.native.append).not.toHaveBeenCalled();
  } finally {
    releaseFirst();
    releaseSecond();
    f.finish();
    f.queue.setOwner(null);
  }
});
