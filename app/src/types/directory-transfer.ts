import type { FileTransferResult } from "./file-transfer.js";
export type DirectoryDirection = "upload" | "download";
export type DirectoryChoice = "create" | "merge" | "overwrite" | "skip";
interface DirectoryFields {
  path: string;
  canonicalPath?: string;
  direction: DirectoryDirection;
  localGrantId: string;
  localVersion: string;
  overwrite: boolean;
  timeoutMs?: number;
}
export type DirectoryAction = DirectoryFields &
  (
    | {
        type: "file.directory.preview";
        renames?: Array<{ relativePath: string; name: string }>;
      }
    | {
        type: "file.directory.confirm";
        previewId: string;
        revision: string;
        choices: Array<{ id: string; action: DirectoryChoice }>;
      }
    | {
        type: "file.directory.entry";
        previewId: string;
        revision: string;
        entryId: string;
        rootPath: string;
        canonicalRoot: string;
      }
  );
export interface DirectoryResult {
  previewId: string;
  revision: string;
  direction: DirectoryDirection;
  phase: "preview" | "confirmed" | "entry";
  entries: number;
  files: number;
  directories: number;
  excluded: number;
  totalBytes: number;
  entryId?: string;
  entryKind?: "file" | "directory";
  entryState?:
    "created" | "merged" | "skipped" | "succeeded" | "failed" | "unknown";
}
export interface DirectoryEntryView {
  id: string;
  parentId?: string;
  relativePath: string;
  sourceRelativePath: string;
  path: string;
  kind: "file" | "directory" | "excluded";
  size: number;
  status: "new" | "directory" | "conflict" | "blocked";
  error?: string;
  action?: DirectoryChoice;
  operation?: {
    id: string;
    status: string;
    error?: string;
    auditGap?: boolean;
  };
  result?: {
    status: "succeeded" | "failed" | "unknown";
    error?: string;
    transfer?: FileTransferResult;
    state?: DirectoryResult["entryState"];
  };
}
export interface DirectoryPreviewView {
  overwrite: boolean;
  renames?: Array<{ relativePath: string; name: string }>;
  timeoutMs?: number;
  id: string;
  revision: string;
  taskId: string;
  direction: DirectoryDirection;
  path: string;
  localGrantId: string;
  localVersion: string;
  state: "preview" | "confirmed";
  entries: number;
  files: number;
  directories: number;
  excluded: number;
  totalBytes: number;
  createdAt: number;
  expiresAt: number;
}
export const isDirectoryAction = (action: {
  type: string;
}): action is DirectoryAction =>
  action.type === "file.directory.preview" ||
  action.type === "file.directory.confirm" ||
  action.type === "file.directory.entry";

export interface DirectoryRunView {
  id: string;
  taskId: string;
  previewId: string;
  state:
    | "running"
    | "awaiting-approval"
    | "paused-human"
    | "paused-error"
    | "completed"
    | "completed-with-errors"
    | "cancelled";
  completed: number;
  total: number;
  currentEntryId?: string;
  operationId?: string;
  error?: string;
  createdAt: number;
  endedAt?: number;
}

export interface DirectoryPreviewPage extends DirectoryPreviewView {
  offset: number;
  items: DirectoryEntryView[];
  nextOffset: number | null;
  contentTrust: string;
}
