import type { DownloadSource, LocalDownloadView } from "./file-download.js";
export interface DownloadRecoverySummary {
  id: string;
  hostLabel?: string;
  path?: string;
  localPath?: string;
  size?: number;
  writtenBytes?: number;
  savedAt?: number;
  existing?: boolean;
  state:
    | "available"
    | "interrupted"
    | "claimed"
    | "committing"
    | "unknown"
    | "completed"
    | "cancelled"
    | "unreadable";
  error?: string;
}
export interface RestoredDownload {
  source: DownloadSource;
  local: LocalDownloadView;
  summary: DownloadRecoverySummary;
}
