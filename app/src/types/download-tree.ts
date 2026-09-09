export const DOWNLOAD_TREE_MAX_ENTRIES = 4096;
export const DOWNLOAD_TREE_MAX_DEPTH = 64;
export interface DownloadTreeEntry {
  id: string;
  parentId?: string;
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: number;
  error?: string;
}
export interface DownloadTreePreview {
  id: string;
  sessionId: string;
  hostIdentity?: string;
  entries: DownloadTreeEntry[];
  files: number;
  directories: number;
  totalBytes: number;
  skipped: number;
  scannedAt: number;
  expiresAt: number;
}
export interface ScanDownloadTree {
  sessionId: string;
  paths: string[];
}
import type {
  DownloadNativeResult,
  LocalDownloadSpec,
  LocalDownloadView,
} from "./file-download.js";
export interface LocalDownloadTreeMapping {
  id: string;
  parentId?: string;
  name: string;
  kind: "file" | "directory";
  size: number;
}
export type LocalDownloadTreeAction = "create" | "merge" | "overwrite" | "skip";
export type DirectoryDownloadState =
  "created" | "merged" | "skipped" | "failed" | "unknown" | "completed";
export interface LocalDownloadTreeEntry extends LocalDownloadTreeMapping {
  relativePath: string;
  path?: string;
  status: "new" | "directory" | "conflict" | "blocked";
  existing?: { size: number; modifiedAt: number };
  error?: string;
  action?: LocalDownloadTreeAction;
  result?: { state: DirectoryDownloadState; error?: string };
}
export interface LocalDownloadTreePreview {
  id: string;
  path: string;
  revision: string;
  state: "preview" | "ready" | "cancelled";
  entries: LocalDownloadTreeEntry[];
}
export interface DirectoryDownloadResult {
  id: string;
  path?: string;
  state: DirectoryDownloadState;
  error?: string;
}
export interface DesktopDownloadDirectoryApi {
  recovery?(
    operation: string,
    ticketId?: string,
    args?: Record<string, unknown>,
  ): Promise<DownloadNativeResult<unknown>>;
  choose(): Promise<DownloadNativeResult<LocalDownloadTreePreview | null>>;
  preview(
    id: string,
    entries: LocalDownloadTreeMapping[],
  ): Promise<DownloadNativeResult<LocalDownloadTreePreview>>;
  confirm(
    id: string,
    revision: string,
    decisions: Array<{ id: string; action: LocalDownloadTreeAction }>,
  ): Promise<DownloadNativeResult<LocalDownloadTreePreview>>;
  directories(
    id: string,
  ): Promise<DownloadNativeResult<DirectoryDownloadResult[]>>;
  file(
    id: string,
    entryId: string,
    spec: LocalDownloadSpec,
    sourceId?: string,
  ): Promise<DownloadNativeResult<LocalDownloadView>>;
  complete(
    id: string,
    entryId: string,
  ): Promise<DownloadNativeResult<LocalDownloadView>>;
  show(id: string, entryId: string): Promise<DownloadNativeResult<null>>;
  cancel(id: string): Promise<DownloadNativeResult<LocalDownloadTreePreview>>;
  forget(id: string): Promise<DownloadNativeResult<null>>;
}
