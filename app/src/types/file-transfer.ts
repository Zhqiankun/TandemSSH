/** A task references an explicitly selected local capability, never a raw local path. */
interface TransferActionFields {
  path: string;
  canonicalPath?: string;
  localGrantId: string;
  localVersion: string;
  overwrite: boolean;
  timeoutMs?: number;
}
export type FileTransferAction = TransferActionFields &
  ({ type: "file.upload" } | { type: "file.download" });
export interface FileTransferResult {
  direction: "upload" | "download";
  localGrantId: string;
  localVersion: string;
  transferId: string;
  bytes: number;
  totalBytes: number;
  verification: "none" | "sha256";
  sha256?: string;
  cleanupRequired: boolean;
}
