import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { DesktopDownloadApi, DownloadSource, LocalDownloadView } from "@/types/file-download";
import type { DownloadApiPort } from "@/api/file-download-api";
vi.mock("@/main-axios", () => ({ getFileManagerApiForSession: vi.fn() }));
import { DownloadQueue } from "../../../../features/file-manager/downloads/queue";
const digest = "a".repeat(64);
function fixture(unknownCommit = false) {
  const source: DownloadSource = { id: "source", sessionId: "session", path: "/result", canonicalPath: "/result", size: 4, sha256: digest, hashes: [digest], chunkBytes: 4194304, state: "ready", expiresAt: Date.now() + 60000 };
  const local: LocalDownloadView = { id: "local", path: "C:/chosen/result", size: 4, writtenBytes: 0, state: "preview" };
  const api: DownloadApiPort = { prepare: vi.fn(async () => source), chunk: vi.fn(async () => new Uint8Array([1, 2, 3, 4])), action: vi.fn(async (_session, _id, action) => ({ ...source, state: action === "verify" ? "verified" : action === "cancel" ? "cancelled" : "ready" })) };
  let finish!: () => void;
  const ending = new Promise<void>(resolve => { finish = resolve; });
  const native: DesktopDownloadApi = {
    reset: vi.fn(async () => ({ ok: true as const, value: null })), choose: vi.fn(async () => ({ ok: true as const, value: { ...local } })),
    start: vi.fn(async () => ({ ok: true as const, value: { ...local, state: "writing" as const, temporaryPath: "C:/chosen/.part" } })),
    append: vi.fn(async () => ({ ok: true as const, value: { ...local, state: "writing" as const, writtenBytes: 4, temporaryPath: "C:/chosen/.part" } })),
    action: vi.fn(async (_id, action) => { if (action === "finish") { await ending; return unknownCommit ? { ok: false as const, error: "DOWNLOAD_RESULT_UNVERIFIED" } : { ok: true as const, value: { ...local, state: "completed" as const, writtenBytes: 4, sha256: digest } }; } return { ok: true as const, value: { ...local, state: "cancelled" as const } }; }),
  };
  const queue = new DownloadQueue(api, () => native); queue.setOwner("owner");
  const id = queue.add({ sessionId: "session", path: "/result", name: "result", hostLabel: "host" });
  return { queue, id, native, api, finish };
}
describe("desktop download queue", () => {
  it("waits for destination review and native final verification before reporting completion", async () => {
    const f = fixture(); await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review")); expect(f.native.start).not.toHaveBeenCalled();
    f.queue.start(f.id, false); await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("finalizing"));
    expect(f.queue.getSnapshot()[0].writtenBytes).toBe(4); f.finish(); await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("completed"));
    expect(f.queue.getSnapshot()[0].local?.sha256).toBe(digest); f.queue.setOwner(null);
  });
  it("preserves an uncertain commit and does not re-run an overwrite", async () => {
    const f = fixture(true); await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("awaiting-review")); f.queue.start(f.id, false); f.finish();
    await waitFor(() => expect(f.queue.getSnapshot()[0].state).toBe("unknown")); await f.queue.retry(f.id); f.queue.resume(f.id); await f.queue.cancel(f.id);
    expect(f.queue.getSnapshot()[0].state).toBe("unknown"); expect(f.api.chunk).toHaveBeenCalledOnce(); f.queue.setOwner(null);
  });
});
