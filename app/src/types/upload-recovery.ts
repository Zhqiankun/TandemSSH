import type { UploadManifest, UploadView } from "./file-upload.js";
export interface UploadRecoverySummary {
  id: string;
  name: string;
  path: string;
  hostIdentity?: string;
  size: number;
  receivedBytes: number;
  updatedAt: number;
  existing: boolean;
  state:
    | "available"
    | "claimed"
    | "interrupted"
    | "committing"
    | "unknown"
    | "completed"
    | "cancelled";
}
export interface RestoredUpload {
  view: UploadView;
  manifest: UploadManifest;
  summary: UploadRecoverySummary;
}
