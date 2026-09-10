import {
  AUDIT_EXPORT_LIMITS,
  type AuditExportSummary,
} from "@/types/task-history";
export interface HistoryExportProgress {
  bytes: number;
  records: number;
}
export async function collectHistoryExport(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  taskId?: string,
  progress?: (value: HistoryExportProgress) => void,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true }),
    chunks: BlobPart[] = [];
  let bytes = 0,
    records = 0,
    pending = "",
    header = false,
    summary: AuditExportSummary | undefined,
    reported = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const line = (text: string) => {
    if (text.length > AUDIT_EXPORT_LIMITS.lineBytes || summary)
      throw Error("HISTORY_EXPORT_INVALID");
    const frame = JSON.parse(text);
    if (!header) {
      if (
        frame.kind !== "header" ||
        frame.schemaVersion !== 1 ||
        frame.taskId !== (taskId ?? null) ||
        !Number.isSafeInteger(frame.startedAt) ||
        !Number.isFinite(frame.retentionDays)
      )
        throw Error("HISTORY_EXPORT_INVALID");
      header = true;
      return;
    }
    if (frame.kind === "record") {
      if (++records > AUDIT_EXPORT_LIMITS.records)
        throw Error("HISTORY_EXPORT_LIMIT");
      if (
        !frame.record ||
        typeof frame.record !== "object" ||
        Array.isArray(frame.record)
      )
        throw Error("HISTORY_EXPORT_INVALID");
    } else if (
      frame.kind === "summary" &&
      frame.completed === true &&
      frame.records === records &&
      Number.isSafeInteger(frame.skipped) &&
      frame.skipped >= 0 &&
      Number.isSafeInteger(frame.scannedBytes) &&
      frame.scannedBytes >= 0
    )
      summary = frame;
    else throw Error("HISTORY_EXPORT_INVALID");
  };
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > AUDIT_EXPORT_LIMITS.bytes)
        throw Error("HISTORY_EXPORT_LIMIT");
      chunks.push(new Uint8Array(part.value).buffer);
      for (let offset = 0; offset < part.value.length; offset += 65536) {
        pending += decoder.decode(part.value.subarray(offset, offset + 65536), {
          stream: true,
        });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          line(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > AUDIT_EXPORT_LIMITS.lineBytes)
          throw Error("HISTORY_EXPORT_LIMIT");
      }
      if (bytes - reported >= 256 * 1024) {
        reported = bytes;
        progress?.({ bytes, records });
      }
    }
    pending += decoder.decode();
    if (pending.length || !header || !summary)
      throw Error("HISTORY_EXPORT_INCOMPLETE");
    signal.throwIfAborted();
    progress?.({ bytes, records });
    return {
      blob: new Blob(chunks, { type: "application/x-ndjson;charset=utf-8" }),
      summary,
      bytes,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
