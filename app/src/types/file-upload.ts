export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const UPLOAD_MAX_CHUNKS = 16384;
export interface UploadManifest {
  name: string;
  size: number;
  lastModified: number;
  hashes: string[];
}
export type UploadState =
  | "preview"
  | "uploading"
  | "paused"
  | "verifying"
  | "committing"
  | "completed"
  | "failed"
  | "unknown"
  | "cancelled"
  | "expired";
export interface UploadView {
  id: string;
  sessionId: string;
  path: string;
  canonicalPath: string;
  hostIdentity?: string;
  name: string;
  totalBytes: number;
  receivedBytes: number;
  chunkBytes: number;
  state: UploadState;
  existing?: { size: number; mtime: number; mode: number };
  temporaryPath?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
  verification?: "sha256";
  sha256?: string;
  atomic?: boolean;
  commitMayHaveOccurred?: boolean;
}
export interface PrepareUpload {
  requestId: string;
  sessionId: string;
  path: string;
  manifest: UploadManifest;
}
export interface StartUpload {
  overwrite: boolean;
  takeover?: boolean;
}
