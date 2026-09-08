export interface FileMetadata {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtime: number;
  atime: number;
  mode: number;
  uid: number;
  gid: number;
}
export interface FileStatView {
  path: string;
  canonicalPath: string;
  followedLinks: boolean;
  observedAt: number;
  metadata: FileMetadata;
}
export interface FileDirectoryEntry {
  name: string;
  metadata: FileMetadata;
}
export interface FileDirectoryView {
  path: string;
  canonicalPath: string;
  snapshotId: string;
  observedAt: number;
  entries: FileDirectoryEntry[];
  total: number;
  omitted: number;
  offset: number;
  nextCursor?: string;
  contentTrust: "untrusted-directory-entries";
}
export type FileInspectionAction =
  | {
      type: "file.list";
      path: string;
      canonicalPath?: string;
      cursor?: string;
      pageSize?: number;
      timeoutMs?: number;
    }
  | {
      type: "file.stat";
      path: string;
      canonicalPath?: string;
      followLinks?: boolean;
      timeoutMs?: number;
    };
