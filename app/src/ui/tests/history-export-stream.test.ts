import { expect, it, vi } from "vitest";
vi.mock("@/types/task-history", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/types/task-history")>();
  return {
    ...original,
    AUDIT_EXPORT_LIMITS: {
      ...original.AUDIT_EXPORT_LIMITS,
      bytes: 1024,
      lineBytes: 256,
      records: 20,
    },
  };
});
import { collectHistoryExport } from "@/api/history-export-stream";
const header = {
  kind: "header",
  schemaVersion: 1,
  startedAt: 1,
  taskId: null,
  retentionDays: 7,
};
const record = {
  kind: "record",
  record: { id: "event", data: { text: "中文🛶" } },
};
const summary = {
  kind: "summary",
  completed: true,
  records: 1,
  skipped: 0,
  scannedBytes: 123,
};
function stream(text: string, oneByte = false) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(c) {
      if (oneByte) for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      else c.enqueue(bytes);
      c.close();
    },
  });
}
const encode = (frames: unknown[]) =>
  frames.map((f) => JSON.stringify(f) + "\n").join("");
it("preserves split UTF-8 and returns a file only after a matching footer", async () => {
  const text = encode([header, record, summary]);
  const result = await collectHistoryExport(
    stream(text, true),
    new AbortController().signal,
  );
  expect(result.summary.records).toBe(1);
  expect(result.blob.size).toBe(new TextEncoder().encode(text).length);
});
it("rejects missing, mismatched or followed-by-extra-data completion markers", async () => {
  for (const frames of [
    [header, record],
    [header, record, { ...summary, records: 2 }],
    [header, record, summary, record],
  ])
    await expect(
      collectHistoryExport(
        stream(encode(frames)),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/HISTORY_EXPORT_/);
});
it("rejects a different task scope and bounded line or body overflow", async () => {
  await expect(
    collectHistoryExport(
      stream(encode([header, summary])),
      new AbortController().signal,
      "different",
    ),
  ).rejects.toThrow("HISTORY_EXPORT_INVALID");
  await expect(
    collectHistoryExport(stream("x".repeat(257)), new AbortController().signal),
  ).rejects.toThrow("HISTORY_EXPORT_LIMIT");
  await expect(
    collectHistoryExport(
      stream("x".repeat(1025)),
      new AbortController().signal,
    ),
  ).rejects.toThrow("HISTORY_EXPORT_LIMIT");
});
it("cancels a pending reader without treating end-of-stream as success", async () => {
  const stop = new AbortController(),
    cancel = vi.fn();
  const pending = collectHistoryExport(
    new ReadableStream({ cancel }),
    stop.signal,
  );
  stop.abort(Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(cancel).toHaveBeenCalledOnce();
});
