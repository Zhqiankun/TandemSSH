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

it("changes download concurrency live without aborting active sources or mixing local files", async () => {
  const { createHash } = await import("node:crypto");
  const data = new Map(
    Array.from({ length: 5 }, (_, i) => [
      "file-" + i,
      Buffer.from("download-payload-" + i),
    ]),
  );
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const sources = new Map<string, DownloadSource>();
  const locals = new Map<
    string,
    { view: LocalDownloadView; bytes: Buffer; expected: Buffer }
  >();
  const gates = new Map<string, () => void>(),
    started: string[] = [],
    signals: AbortSignal[] = [];
  let active = 0,
    peak = 0;
  const api: DownloadApiPort = {
    prepare: async (input) => {
      const id = input.path.slice(1),
        bytes = data.get(id)!;
      const source: DownloadSource = {
        id,
        sessionId: input.sessionId,
        path: input.path,
        canonicalPath: input.path,
        size: bytes.length,
        sha256: hash(bytes),
        hashes: [hash(bytes)],
        chunkBytes: 4194304,
        state: "ready",
        expiresAt: Date.now() + 60000,
      };
      sources.set(id, source);
      return structuredClone(source);
    },
    chunk: async (_session, id, offset, signal) => {
      expect(offset).toBe(0);
      signals.push(signal);
      started.push(id);
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => gates.set(id, resolve));
        expect(signal.aborted).toBe(false);
        return Uint8Array.from(data.get(id)!);
      } finally {
        active--;
      }
    },
    action: vi.fn(async (_session, id, action) => ({
      ...sources.get(id)!,
      state: action === "verify" ? ("verified" as const) : ("ready" as const),
    })),
  };
  const native: DesktopDownloadApi = {
    reset: async () => ({ ok: true, value: null }),
    choose: async (spec) => {
      const expected = data.get(spec.name)!;
      expect(spec.sha256).toBe(hash(expected));
      const view: LocalDownloadView = {
        id: spec.name,
        path: "C:/chosen/" + spec.name,
        size: spec.size,
        writtenBytes: 0,
        state: "preview",
      };
      locals.set(spec.name, { view, bytes: Buffer.alloc(0), expected });
      return { ok: true, value: { ...view } };
    },
    start: async (id) => {
      const row = locals.get(id)!;
      row.view.state = "writing";
      return { ok: true, value: { ...row.view } };
    },
    append: async (id, offset, bytes) => {
      const row = locals.get(id)!;
      expect(offset).toBe(row.bytes.length);
      row.bytes = Buffer.concat([row.bytes, Buffer.from(bytes)]);
      expect(row.bytes).toEqual(row.expected.subarray(0, row.bytes.length));
      row.view.writtenBytes = row.bytes.length;
      return { ok: true, value: { ...row.view } };
    },
    action: vi.fn(async (id, action) => {
      const row = locals.get(id)!;
      if (action === "finish") {
        expect(row.bytes).toEqual(row.expected);
        row.view.state = "completed";
        row.view.sha256 = hash(row.bytes);
      }
      return { ok: true as const, value: { ...row.view } };
    }),
  };
  const queue = new DownloadQueue(api, () => native);
  queue.setOwner("owner");
  queue.setConcurrency(1);
  const ids = [...data.keys()].map((name) =>
    queue.add({
      name,
      path: "/" + name,
      sessionId: "session",
      hostLabel: "独立下载目标",
    }),
  );
  try {
    await waitFor(() =>
      expect(
        queue.getSnapshot().every((j) => j.state === "awaiting-review"),
      ).toBe(true),
    );
    ids.forEach((id) => queue.start(id, false));
    await waitFor(() => expect(started).toHaveLength(1));
    queue.setConcurrency(3);
    await waitFor(() => expect(started).toHaveLength(3));
    expect(active).toBe(3);
    queue.setConcurrency(1);
    expect(active).toBe(3);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    gates.get(started[0])!();
    gates.get(started[1])!();
    await waitFor(() =>
      expect(
        queue.getSnapshot().filter((j) => j.state === "completed"),
      ).toHaveLength(2),
    );
    expect(started).toHaveLength(3);
    gates.get(started[2])!();
    await waitFor(() => expect(started).toHaveLength(4));
    expect(active).toBe(1);
    gates.get(started[3])!();
    await waitFor(() => expect(started).toHaveLength(5));
    expect(active).toBe(1);
    gates.get(started[4])!();
    await waitFor(() =>
      expect(queue.getSnapshot().every((j) => j.state === "completed")).toBe(
        true,
      ),
    );
    expect(peak).toBe(3);
    expect(locals.size).toBe(5);
    for (const row of locals.values()) expect(row.bytes).toEqual(row.expected);
    expect(
      vi
        .mocked(native.action)
        .mock.calls.some((c) => c[1] === "pause" || c[1] === "cancel"),
    ).toBe(false);
  } finally {
    for (const release of gates.values()) release();
    queue.setOwner(null);
  }
});

it("cleans the local target before waiting for a delayed remote cancellation", async () => {
  const f = fixture();
  await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review"));
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const original = vi.mocked(f.api.action).getMockImplementation()!;
  vi.mocked(f.api.action).mockImplementation(async (...args) => {
    if (args[2] === "cancel") await delayed;
    return original(...args);
  });
  const cancelling = f.queue.cancel(f.id);
  try {
    await waitFor(() => expect(f.native.action).toHaveBeenCalledWith("local", "cancel"));
  } finally {
    release();
    await cancelling;
    f.queue.setOwner(null);
  }
});
