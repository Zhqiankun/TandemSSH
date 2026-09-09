import type { UploadManifest, UploadView } from "./file-upload.js";
import type { NativeUploadSelection } from "./upload-source.js";
import type { UploadTreePreview } from "./upload-tree.js";
export type UploadBatchMemberState =
  "pending" | "paused" | "committing" | "unknown" | "completed" | "cancelled";
export interface UploadBatchRecoverySummary {
  id: string;
  name: string;
  path: string;
  hostIdentity?: string;
  entries: number;
  completed: number;
  paused: number;
  unknown: number;
  existing: boolean;
  state:
    | "preparing"
    | "available"
    | "claimed"
    | "interrupted"
    | "completed"
    | "cancelled";
  updatedAt: number;
}
export interface RestoredUploadBatch {
  summary: UploadBatchRecoverySummary;
  source: NativeUploadSelection;
  tree: UploadTreePreview;
  members: Array<{
    entryId: string;
    state: UploadBatchMemberState;
    view?: UploadView;
    manifest?: UploadManifest;
  }>;
}
