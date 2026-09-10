import { AuditHistoryReader } from "./history-reader.js";
import type {
  AuditHistoryQuery,
  AuditExportQuery,
} from "../../../types/task-history.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { redact } from "../../privacy/redaction.js";
import type { OperationAuditPort } from "../operations/gateway.js";

/** One journal per OS workspace/user. Only this class owns its generated
 * shards; unrelated files are never removed during retention cleanup. */
export class AuditJournal implements OperationAuditPort {
  private readonly history: AuditHistoryReader;
  private queue: Promise<unknown> = Promise.resolve();
  private current?: { file: string; bytes: number; day: string };
  private readonly directory: string;
  private readonly name = /^record-\d{13}-[a-f0-9-]{36}\.jsonl$/;
  constructor(
    dataDirectory: string,
    userId: string,
    private readonly maxBytes = 100 * 1024 * 1024,
    private readonly retentionMs = 7 * 24 * 60 * 60_000,
  ) {
    this.directory = path.join(
      path.resolve(dataDirectory),
      "tandem-audit",
      createHash("sha256").update(userId).digest("hex").slice(0, 24),
    );
    this.history = new AuditHistoryReader(
      this.directory,
      this.retentionMs,
      this.maxBytes,
    );
  }
  async queryHistory(query: AuditHistoryQuery) {
    await this.queue;
    return this.history.query(query);
  }
  async *exportHistory(query: AuditExportQuery, signal: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      this.queue.then(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    yield* this.history.exportHistory(query, signal);
  }
  async historyDetail(token: string, offset?: number) {
    await this.queue;
    return this.history.detail(token, offset);
  }
  append(event: Parameters<OperationAuditPort["append"]>[0]): Promise<void> {
    return this.record(event.type, event.operation);
  }
  record(type: string, data: unknown): Promise<void> {
    const safe = redact(data);
    const line =
      JSON.stringify({
        schemaVersion: 1,
        id: randomUUID(),
        at: Date.now(),
        type,
        data: safe,
      }) + "\n";
    if (Buffer.byteLength(line) > Math.min(1024 * 1024, this.maxBytes))
      return Promise.reject(new Error("AUDIT_EVENT_TOO_LARGE"));
    const work = this.queue.then(() => this.write(line));
    this.queue = work.catch(() => {});
    return work;
  }
  private async write(line: string): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const now = Date.now(),
      size = Buffer.byteLength(line),
      day = new Date(now).toISOString().slice(0, 10);
    const entries = await fs.readdir(this.directory);
    const files = await Promise.all(
      entries
        .filter((name) => this.name.test(name))
        .map(async (name) => {
          const file = path.join(this.directory, name),
            stat = await fs.lstat(file);
          return {
            file,
            bytes: stat.size,
            time: stat.mtimeMs,
            regular: stat.isFile() && !stat.isSymbolicLink(),
          };
        }),
    );
    const regular = files
      .filter((file) => file.regular)
      .sort((a, b) => a.time - b.time);
    let total = regular.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of regular) {
      if (now - file.time < this.retentionMs && total + size <= this.maxBytes)
        continue;
      // file is generated under the resolved journal directory, not a user path.
      if (path.dirname(path.resolve(file.file)) !== this.directory)
        throw new Error("AUDIT_PATH_INVALID");
      await fs.unlink(file.file);
      total -= file.bytes;
      if (this.current?.file === file.file) this.current = undefined;
    }
    if (
      !this.current ||
      this.current.day !== day ||
      this.current.bytes + size > 1024 * 1024
    ) {
      this.current = {
        file: path.join(this.directory, `record-${now}-${randomUUID()}.jsonl`),
        bytes: 0,
        day,
      };
    }
    await fs.appendFile(this.current.file, line, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.current.bytes += size;
  }
}
