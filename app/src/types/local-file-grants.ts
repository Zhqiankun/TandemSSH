import type { DownloadNativeResult } from "./file-download.js";
export interface LocalFileGrantView {
  kind?: "directory";
  entries?: number;
  excluded?: number;
  id: string;
  version: string;
  taskId: string;
  direction: "upload" | "download";
  name: string;
  size?: number;
  allowOverwrite: boolean;
  state: "active" | "revoked" | "consumed";
  createdAt: number;
  expiresAt: number;
  error?: string;
}
export interface HumanLocalFileGrant extends LocalFileGrantView {
  path: string;
  existing?: { size: number; modifiedAt: number };
  temporaryPath?: string;
  transferState?: string;
}
export interface LocalFileTicket {
  kind?: "directory";
  id: string;
  direction: "upload" | "download";
  expiresAt: number;
}
export interface DesktopLocalFilesApi {
  identity(): Promise<DownloadNativeResult<{ windowToken: string }>>;
  choose(
    ticketId: string,
  ): Promise<DownloadNativeResult<{ grants: HumanLocalFileGrant[] } | null>>;
  reset(): Promise<DownloadNativeResult<null>>;
}
