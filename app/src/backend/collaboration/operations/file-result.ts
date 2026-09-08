import { posix } from "node:path";
import { z } from "zod";
import type {
  FileExecutionResult,
  FileAction,
} from "../../../types/file-operations.js";
import {
  filePathSchema,
  directoryCursorSchema,
} from "../policies/file-policy.js";
const format = z
  .object({
    charset: z.enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"]),
    bom: z.boolean(),
    lineEnding: z.enum(["lf", "crlf", "cr", "mixed", "none"]),
  })
  .strict();
const document = z
  .object({
    documentId: z.string().uuid(),
    version: z.string().uuid(),
    path: filePathSchema,
    canonicalPath: filePathSchema,
    hostIdentity: z.string().max(2048).optional(),
    size: z.number().int().nonnegative(),
    mtime: z.number().nonnegative(),
    mode: z.number().int().min(0).max(0o7777),
    viaSymlink: z.boolean(),
    editable: z.boolean(),
    format: format.optional(),
    readOnlyReason: z
      .enum(["binary", "encoding-required", "too-large"])
      .optional(),
  })
  .strict();
const metadata = z
  .object({
    kind: z.enum(["file", "directory", "symlink", "other"]),
    size: z.number().int().nonnegative().safe(),
    mtime: z.number().nonnegative(),
    atime: z.number().nonnegative(),
    mode: z.number().int().min(0).max(0o7777),
    uid: z.number().int().nonnegative(),
    gid: z.number().int().nonnegative(),
  })
  .strict();
const inspectionPath = {
  path: filePathSchema,
  canonicalPath: filePathSchema,
  observedAt: z.number().int().nonnegative(),
};
const entry = z
  .object({
    name: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (v) =>
          v !== "." &&
          v !== ".." &&
          !v.includes("/") &&
          !/[\x00-\x1f\x7f]/.test(v),
      ),
    metadata,
  })
  .strict();
const schema = z
  .object({
    status: z.enum(["succeeded", "failed", "unknown"]),
    error: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,80}$/)
      .optional(),
    result: z
      .object({
        transfer: z
          .object({
            direction: z.enum(["upload", "download"]),
            localGrantId: z.string().uuid(),
            localVersion: z.string().uuid(),
            transferId: z.string().uuid(),
            bytes: z.number().int().nonnegative().safe().max(68719476736),
            totalBytes: z.number().int().nonnegative().safe().max(68719476736),
            verification: z.enum(["none", "sha256"]),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            cleanupRequired: z.boolean(),
          })
          .strict()
          .optional(),
        directory: z
          .object({
            ...inspectionPath,
            snapshotId: z.string().uuid(),
            entries: z.array(entry).max(100),
            total: z.number().int().min(0).max(10000),
            omitted: z.number().int().min(0).max(10000),
            offset: z.number().int().min(0).max(10000),
            nextCursor: directoryCursorSchema.optional(),
            contentTrust: z.literal("untrusted-directory-entries"),
          })
          .strict()
          .optional(),
        metadata: z
          .object({ ...inspectionPath, followedLinks: z.boolean(), metadata })
          .strict()
          .optional(),
        document: document.optional(),
        bytes: z.number().int().nonnegative().optional(),
        temporaryPath: filePathSchema.optional(),
        commitMayHaveOccurred: z.boolean().optional(),
        contentAvailable: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export function validateFileResult(
  value: unknown,
  action?: FileAction,
  canonicalPath?: string,
): FileExecutionResult {
  const result = schema.safeParse(value);
  if (
    !result.success ||
    (result.data.status === "succeeded" &&
      (result.data.error || result.data.result?.commitMayHaveOccurred))
  )
    throw Error("INVALID_FILE_RESULT");
  const data = result.data,
    resultView = data.result,
    directory = resultView?.directory,
    meta = resultView?.metadata;
  const transfer = resultView?.transfer;
  if (transfer) {
    if (
      directory ||
      meta ||
      resultView?.document ||
      resultView?.contentAvailable !== undefined ||
      transfer.bytes > transfer.totalBytes ||
      (transfer.verification === "sha256") !== !!transfer.sha256 ||
      (resultView?.bytes !== undefined && resultView.bytes !== transfer.bytes)
    )
      throw Error("INVALID_FILE_RESULT");
    if (
      action &&
      (action.type !== "file." + transfer.direction ||
        !("localGrantId" in action) ||
        action.localGrantId !== transfer.localGrantId ||
        action.localVersion !== transfer.localVersion)
    )
      throw Error("INVALID_FILE_RESULT");
    if (
      data.status === "succeeded" &&
      (transfer.bytes !== transfer.totalBytes ||
        transfer.verification !== "sha256" ||
        transfer.cleanupRequired ||
        resultView?.temporaryPath)
    )
      throw Error("INVALID_FILE_RESULT");
  }
  if (
    action &&
    (action.type === "file.upload" || action.type === "file.download") &&
    data.status === "succeeded" &&
    !transfer
  )
    throw Error("INVALID_FILE_RESULT");
  if (directory || meta) {
    if (
      (directory && meta) ||
      resultView?.document ||
      resultView?.bytes !== undefined ||
      resultView?.contentAvailable !== undefined ||
      resultView?.temporaryPath ||
      resultView?.commitMayHaveOccurred !== undefined
    )
      throw Error("INVALID_FILE_RESULT");
    const info = directory ?? meta!;
    if (
      action &&
      (action.type !== (directory ? "file.list" : "file.stat") ||
        posix.normalize(action.path) !== info.path ||
        canonicalPath !== info.canonicalPath)
    )
      throw Error("INVALID_FILE_RESULT");
  }
  if (
    action &&
    data.status === "succeeded" &&
    ((action.type === "file.list" && !directory) ||
      (action.type === "file.stat" && !meta))
  )
    throw Error("INVALID_FILE_RESULT");
  if (directory) {
    const unique = new Set(directory.entries.map((e) => e.name));
    const next = directory.nextCursor?.split(":");
    if (
      unique.size !== directory.entries.length ||
      directory.offset + directory.entries.length > directory.total ||
      (next &&
        (next[0] !== directory.snapshotId ||
          Number(next[1]) <= directory.offset ||
          Number(next[1]) >= directory.total))
    )
      throw Error("INVALID_FILE_RESULT");
  }
  if (
    (directory || meta) &&
    Buffer.byteLength(JSON.stringify(data), "utf8") > 64000
  )
    throw Error("INVALID_FILE_RESULT");
  return structuredClone(data);
}
