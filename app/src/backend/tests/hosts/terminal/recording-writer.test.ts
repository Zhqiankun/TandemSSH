import { afterEach, expect, it, vi } from "vitest";
import { RecordingWriter } from "../../../hosts/terminal/recording-writer.js";
import {
  parseRecordingFailure,
  recordingFailureReason,
} from "../../../../types/terminal-recording.js";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
it("keeps in-flight plus pending bytes bounded and never writes discarded events", async () => {
  const held = deferred(),
    write = vi.fn(() => held.promise),
    failed = vi.fn();
  const writer = new RecordingWriter({ write, failed, maxPendingBytes: 4 });
  expect(writer.append("界")).toBe(true);
  const flushed = writer.flush();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(writer.append("x")).toBe(true);
  expect(writer.snapshot().pendingBytes).toBe(4);
  expect(writer.append("y")).toBe(false);
  await flushed;
  expect(failed).toHaveBeenCalledWith("capacity");
  expect(writer.snapshot()).toMatchObject({
    pendingBytes: 3,
    writing: true,
    committedBytes: 0,
  });
  held.resolve();
  await vi.waitFor(() => expect(writer.snapshot().writing).toBe(false));
  expect(writer.committedBytes).toBe(3);
  expect(write).toHaveBeenCalledOnce();
  expect(writer.append("later")).toBe(false);
});
it("bounds tiny event counts and settles shutdown after a capacity stop", async () => {
  const held = deferred(),
    failed = vi.fn(),
    write = vi.fn(() => held.promise);
  const writer = new RecordingWriter({ write, failed, maxPendingItems: 2 });
  writer.append("a");
  void writer.flush();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  writer.append("b");
  expect(writer.append("c")).toBe(false);
  await writer.close();
  expect(writer.snapshot().pendingItems).toBe(1);
  held.resolve();
  await vi.waitFor(() => expect(writer.snapshot().writing).toBe(false));
  expect(write).toHaveBeenCalledOnce();
});
it("batches in order with one first write and flushes the final events on close", async () => {
  const writes: Array<{ chunk: string; first: boolean }> = [];
  let active = 0,
    maxActive = 0;
  const writer = new RecordingWriter({
    failed: vi.fn(),
    write: async (chunk, first) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      writes.push({ chunk, first });
      active--;
    },
  });
  writer.append("一\n");
  writer.append("二\n");
  await writer.flush();
  writer.append("三\n");
  await writer.close();
  expect(writes).toEqual([
    { chunk: "一\n二\n", first: true },
    { chunk: "三\n", first: false },
  ]);
  expect(maxActive).toBe(1);
  expect(writer.committedBytes).toBe(Buffer.byteLength("一\n二\n三\n"));
  expect(writer.append("no")).toBe(false);
});
it("stops on storage rejection without rejecting flush or depending on its failure observer", async () => {
  const writer = new RecordingWriter({
    write: async () => {
      throw Error("disk full");
    },
    failed: () => {
      throw Error("observer unavailable");
    },
  });
  writer.append("line\n");
  await expect(writer.flush()).resolves.toBeUndefined();
  expect(writer.failure).toBe("write-failed");
  expect(writer.committedBytes).toBe(0);
  expect(writer.append("later")).toBe(false);
});
it("reports write timeout promptly and does not restart when the old write later succeeds", async () => {
  vi.useFakeTimers();
  const held = deferred(),
    failed = vi.fn(),
    write = vi.fn(() => held.promise);
  const writer = new RecordingWriter({ write, failed, writeTimeoutMs: 25 });
  writer.append("old\n");
  const flushed = writer.flush();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(25);
  await flushed;
  expect(writer.failure).toBe("write-timeout");
  expect(writer.snapshot().writing).toBe(true);
  expect(writer.append("new\n")).toBe(false);
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(write).toHaveBeenCalledOnce();
  expect(writer.committedBytes).toBe(4);
  expect(failed).toHaveBeenCalledOnce();
});
it("does not create an empty recording and validates failure metadata codes", async () => {
  const write = vi.fn(async () => {}),
    writer = new RecordingWriter({ write, failed: vi.fn() });
  await writer.close();
  expect(write).not.toHaveBeenCalled();
  expect(parseRecordingFailure(recordingFailureReason("capacity"))).toBe(
    "capacity",
  );
  expect(parseRecordingFailure("recording-stopped:arbitrary")).toBeNull();
  expect(parseRecordingFailure(null)).toBeNull();
});
