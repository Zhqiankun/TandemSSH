import type { DownloadSource, LocalDownloadView } from "./file-download.js";
import type {
  DownloadTreePreview,
  LocalDownloadTreePreview,
  LocalDownloadTreeEntry,
} from "./download-tree.js";
export interface DownloadBatchSummary {
  id: string;
  name: string;
  hostLabel: string;
  localPath: string;
  entries: number;
  completed: number;
  paused: number;
  unknown: number;
  savedAt: number;
  existing: boolean;
  state:
    | "preparing"
    | "available"
    | "claimed"
    | "interrupted"
    | "completed"
    | "cancelled";
}
export interface RestoredDownloadBatch {
  summary: DownloadBatchSummary;
  source: DownloadTreePreview;
  target: LocalDownloadTreePreview;
  members: Array<{
    entryId: string;
    state:
      | "pending"
      | "paused"
      | "committing"
      | "unknown"
      | "completed"
      | "cancelled";
    source?: DownloadSource;
    local?: LocalDownloadView;
  }>;
}
export interface DownloadBatchDetail {
  summary: DownloadBatchSummary;
  entries: LocalDownloadTreeEntry[];
  members: Array<{ entryId: string; state: string }>;
}
