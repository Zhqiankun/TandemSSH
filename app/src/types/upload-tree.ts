export const UPLOAD_TREE_MAX_ENTRIES = 4096;
export interface UploadTreeMapping {
  id: string;
  parentId?: string;
  name: string;
  kind: "file" | "directory";
  size: number;
  lastModified: number;
}
export type UploadTreeAction = "create" | "merge" | "overwrite" | "skip";
export interface UploadDirectoryResult {
  state: "created" | "merged" | "skipped" | "failed" | "unknown";
  error?: string;
  mode?: number;
}
export interface UploadFileResult {
  state: "completed";
  transferId: string;
  bytes: number;
  sha256: string;
  completedAt: number;
}
export interface UploadTreeEntry extends UploadTreeMapping {
  fileResult?: UploadFileResult;
  path: string;
  relativePath: string;
  status: "new" | "directory" | "conflict" | "blocked";
  existing?: { size: number; mtime: number; mode: number };
  error?: string;
  action?: UploadTreeAction;
  result?: UploadDirectoryResult;
}
export interface UploadTreePreview {
  id: string;
  revision: string;
  sessionId: string;
  path: string;
  canonicalRoot: string;
  hostIdentity?: string;
  state: "preview" | "confirmed" | "cancelled";
  entries: UploadTreeEntry[];
  expiresAt: number;
}
export interface PrepareUploadTree {
  sessionId: string;
  path: string;
  entries: UploadTreeMapping[];
}
