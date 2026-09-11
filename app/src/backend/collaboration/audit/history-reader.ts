import fs from "node:fs/promises";
import {
  AUDIT_EXPORT_LIMITS,
  type AuditExportQuery,
  type AuditExportFrame,
} from "../../../types/task-history.js";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { redact, redactString } from "../../privacy/redaction.js";
import type {
  AuditHistoryQuery,
  AuditHistoryPage,
  AuditHistoryItem,
  AuditHistoryDetail,
} from "../../../types/task-history.js";
const shard = /^record-\d{13}-[a-f0-9-]{36}\.jsonl$/,
  maximum = 1024 * 1024;
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string().length(64),
    filter: z.string().length(64),
    anchor: z.string().regex(shard),
    file: z.string().regex(shard),
    before: z.number().int().min(0).max(maximum),
  })
  .strict();
const detailSchema = z
  .object({
    v: z.literal(1),
    scope: z.string().length(64),
    file: z.string().regex(shard),
    start: z.number().int().min(0).max(maximum),
    length: z.number().int().positive().max(maximum),
    id: z.string().uuid(),
  })
  .strict();
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    at: z.number().int().nonnegative(),
    type: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),
    data: z.unknown(),
  })
  .strict();
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown, max = 512) => {
  if (typeof v !== "string") return undefined;
  const value = redactString(v).slice(0, max);
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
};
const choice = <T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
const nonnegative = (value: unknown) => {
  const n = integer(value);
  return n !== undefined && n >= 0 ? n : undefined;
};
const encode = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
const decode = (v: string) => {
  if (v.length > 2048 || !/^[-_A-Za-z0-9]+$/.test(v))
    throw Error("HISTORY_CURSOR_INVALID");
  try {
    return JSON.parse(Buffer.from(v, "base64url").toString());
  } catch {
    throw Error("HISTORY_CURSOR_INVALID");
  }
};
/** Reads generated shards only; no returned history can grant control or execute actions. */
export class AuditHistoryReader {
  private readonly scope: string;
  private readers = 0;
  private exporting = false;
  constructor(
    private directory: string,
    private retentionMs: number,
    private maxBytes: number,
  ) {
    this.scope = createHash("sha256").update(directory).digest("hex");
  }
  private async files() {
    try {
      const actual = await fs.realpath(this.directory),
        root = await fs.realpath(path.dirname(path.dirname(this.directory))),
        expected = path.join("tandem-audit", path.basename(this.directory));
      if (
        (process.platform === "win32"
          ? path.relative(root, actual).toLowerCase()
          : path.relative(root, actual)) !==
        (process.platform === "win32" ? expected.toLowerCase() : expected)
      )
        throw Error("AUDIT_PATH_INVALID");
      return (await fs.readdir(this.directory, { withFileTypes: true }))
        .filter((e) => e.isFile() && !e.isSymbolicLink() && shard.test(e.name))
        .map((e) => e.name)
        .sort()
        .reverse();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  private async read(file: string, end?: number) {
    if (!shard.test(file)) throw Error("HISTORY_CURSOR_INVALID");
    const full = path.join(this.directory, file),
      before = await fs.lstat(full);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size > maximum
    )
      throw Error("HISTORY_RECORD_INVALID");
    const handle = await fs.open(full, "r");
    try {
      const stat = await handle.stat();
      if (
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.nlink !== 1 ||
        stat.size > maximum
      )
        throw Error("HISTORY_RECORD_INVALID");
      const size = Math.min(end ?? stat.size, stat.size),
        buffer = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const read = await handle.read(buffer, offset, size - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      return buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }
  private row(
    record: z.infer<typeof recordSchema>,
    file: string,
    start: number,
    length: number,
  ): AuditHistoryItem {
    const data = object(record.data),
      context = object(data.context),
      action = object(data.action);
    return {
      id: record.id,
      at: record.at,
      type: record.type,
      taskId: text(
        data.taskId ??
          context.taskId ??
          (record.type.startsWith("task.") ? data.id : undefined),
        128,
      ),
      title: text(data.title),
      hostName: text(data.hostName ?? context.hostName),
      hostId: nonnegative(data.hostId ?? context.hostId),
      sessionId: text(data.sessionId ?? object(context.lease).sessionId, 128),
      origin: choice(context.origin ?? data.source, [
        "human",
        "agent",
        "assistant",
        "workflow",
        "mcp",
        "command-panel",
      ] as const),
      mode: choice(context.mode ?? data.mode, [
        "automatic",
        "collaborative",
      ] as const),
      policyRevision: nonnegative(
        object(data.decision).revision ??
          data.policyRevision ??
          object(data.scope).policyRevision,
      ),
      policyOutcome: choice(object(data.decision).outcome, [
        "allow",
        "confirm",
        "deny",
        "unknown",
      ] as const),
      cwd: text(action.cwd ?? data.resultingCwd, 1024),
      outputPreview: text(data.output, 512),
      outputTruncated:
        typeof data.output === "string"
          ? data.outputTruncated === true ||
            redactString(data.output).length > 512
          : undefined,
      exitCode: integer(data.exitCode),
      status: text(data.status ?? data.state, 80),
      error: text(data.error, 512),
      operationId: record.type.startsWith("operation.")
        ? text(data.id, 128)
        : text(data.operationId, 128),
      actionType: text(action.type, 80),
      program: text(action.program, 256),
      path: text(action.path, 1024),
      detail: encode({
        v: 1,
        scope: this.scope,
        file,
        start,
        length,
        id: record.id,
      }),
    };
  }
  async query(input: AuditHistoryQuery): Promise<AuditHistoryPage> {
    if (this.readers >= 2) throw Error("HISTORY_BUSY");
    this.readers++;
    try {
      const query = z
        .object({
          cursor: z.string().max(2048).optional(),
          taskId: z.string().min(1).max(128).optional(),
          limit: z.number().int().min(1).max(50).default(25),
        })
        .strict()
        .parse(input);
      const filter = createHash("sha256")
        .update(query.taskId ?? "")
        .digest("hex");
      const cursor = query.cursor
        ? cursorSchema.parse(decode(query.cursor))
        : undefined;
      if (cursor && (cursor.scope !== this.scope || cursor.filter !== filter))
        throw Error("HISTORY_CURSOR_INVALID");
      let files = await this.files();
      const anchor = cursor?.anchor ?? files[0];
      files = files.filter(
        (f) => (!anchor || f <= anchor) && (!cursor || f <= cursor.file),
      );
      const result: AuditHistoryPage = {
        items: [],
        nextCursor: null,
        skipped: cursor && !files.includes(cursor.file) ? 1 : 0,
        scannedBytes: 0,
        retentionDays: this.retentionMs / 86400000,
        maxBytes: this.maxBytes,
      };
      let visited = 0,
        last: { file: string; before: number } | undefined;
      for (const file of files) {
        if (++visited > 256 || result.scannedBytes >= 8 * maximum) {
          if (last)
            result.nextCursor = encode({
              v: 1,
              scope: this.scope,
              filter,
              anchor,
              ...last,
            });
          break;
        }
        let buffer: Buffer;
        try {
          buffer = await this.read(
            file,
            cursor?.file === file ? cursor.before : undefined,
          );
        } catch (e) {
          if (
            !["ENOENT"].includes((e as NodeJS.ErrnoException).code ?? "") &&
            (e as Error).message !== "HISTORY_RECORD_INVALID"
          )
            throw e;
          result.skipped++;
          last = { file, before: 0 };
          continue;
        }
        if (cursor?.file === file && buffer.length < cursor.before)
          result.skipped++;
        result.scannedBytes += buffer.length;
        let end = buffer.length;
        if (end && buffer[end - 1] !== 10) {
          result.skipped++;
          end = buffer.lastIndexOf(10) + 1;
        }
        while (end > 0) {
          const start = end > 1 ? buffer.lastIndexOf(10, end - 2) + 1 : 0,
            length = end - start;
          last = { file, before: start };
          try {
            const parsed = recordSchema.parse(
                JSON.parse(buffer.subarray(start, end - 1).toString("utf8")),
              ),
              row = this.row(parsed, file, start, length);
            if (
              parsed.at >= Date.now() - this.retentionMs &&
              (!query.taskId || row.taskId === query.taskId)
            )
              result.items.push(row);
          } catch {
            result.skipped++;
          }
          end = start;
          if (result.items.length >= query.limit) {
            if (end > 0 || file !== files.at(-1))
              result.nextCursor = encode({
                v: 1,
                scope: this.scope,
                filter,
                anchor,
                ...last,
              });
            return result;
          }
        }
        last = { file, before: 0 };
      }
      return result;
    } finally {
      this.readers--;
    }
  }
  async *exportHistory(
    input: AuditExportQuery,
    signal: AbortSignal,
  ): AsyncGenerator<AuditExportFrame> {
    const query = z
      .object({ taskId: z.string().min(1).max(128).optional() })
      .strict()
      .parse(input);
    if (this.exporting) throw Error("HISTORY_EXPORT_BUSY");
    this.exporting = true;
    const startedAt = Date.now(),
      decoder = new TextDecoder("utf-8", { fatal: true });
    let records = 0,
      skipped = 0,
      scannedBytes = 0;
    try {
      signal.throwIfAborted();
      const files = await this.files();
      if (files.length > AUDIT_EXPORT_LIMITS.shards)
        throw Error("HISTORY_EXPORT_LIMIT");
      yield {
        kind: "header",
        schemaVersion: 1,
        startedAt,
        taskId: query.taskId ?? null,
        retentionDays: this.retentionMs / 86400000,
      };
      for (const file of files) {
        signal.throwIfAborted();
        let buffer: Buffer;
        try {
          buffer = await this.read(file);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" &&
            (error as Error).message !== "HISTORY_RECORD_INVALID"
          )
            throw error;
          skipped++;
          continue;
        }
        scannedBytes += buffer.length;
        if (scannedBytes > this.maxBytes) throw Error("HISTORY_EXPORT_LIMIT");
        let end = buffer.length;
        if (end && buffer[end - 1] !== 10) {
          skipped++;
          end = buffer.lastIndexOf(10) + 1;
        }
        while (end > 0) {
          signal.throwIfAborted();
          const start = end > 1 ? buffer.lastIndexOf(10, end - 2) + 1 : 0;
          let record: z.infer<typeof recordSchema>;
          try {
            record = recordSchema.parse(
              JSON.parse(decoder.decode(buffer.subarray(start, end - 1))),
            );
          } catch {
            skipped++;
            end = start;
            continue;
          }
          const row = this.row(record, file, start, end - start);
          end = start;
          if (
            record.at < startedAt - this.retentionMs ||
            record.at > startedAt ||
            (query.taskId && row.taskId !== query.taskId)
          )
            continue;
          if (++records > AUDIT_EXPORT_LIMITS.records)
            throw Error("HISTORY_EXPORT_LIMIT");
          yield { kind: "record", record: redact(record) };
        }
      }
      signal.throwIfAborted();
      yield {
        kind: "summary",
        completed: true,
        records,
        skipped,
        scannedBytes,
      };
    } finally {
      this.exporting = false;
    }
  }
  async detail(token: string, offset = 0): Promise<AuditHistoryDetail> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 4 * maximum)
      throw Error("HISTORY_CURSOR_INVALID");
    const descriptor = detailSchema.parse(decode(token));
    if (
      descriptor.scope !== this.scope ||
      descriptor.start + descriptor.length > maximum
    )
      throw Error("HISTORY_CURSOR_INVALID");
    if (!(await this.files()).includes(descriptor.file))
      throw Error("HISTORY_RECORD_NOT_FOUND");
    const buffer = await this.read(
        descriptor.file,
        descriptor.start + descriptor.length,
      ),
      record = recordSchema.parse(
        JSON.parse(
          buffer
            .subarray(descriptor.start, descriptor.start + descriptor.length)
            .toString("utf8"),
        ),
      );
    if (record.at < Date.now() - this.retentionMs)
      throw Error("HISTORY_RECORD_NOT_FOUND");
    if (record.id !== descriptor.id) throw Error("HISTORY_RECORD_CHANGED");
    const safe = redact(record);
    let value = JSON.stringify(safe, null, 2);
    if (value.length > 2 * maximum) value = JSON.stringify(safe);
    offset = Math.min(offset, value.length);
    if (
      offset &&
      /[\uDC00-\uDFFF]/.test(value[offset] ?? "") &&
      /[\uD800-\uDBFF]/.test(value[offset - 1])
    )
      offset--;
    let end = Math.min(value.length, offset + 16000);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    return {
      id: record.id,
      offset,
      text: value.slice(offset, end),
      total: value.length,
      nextOffset: end < value.length ? end : null,
    };
  }
}
