import type { NativeUploadEntry } from "../../types/upload-source.js";
import type {
  DownloadSource,
  LocalDownloadView,
} from "../../types/file-download.js";
import type {
  LocalDownloadTreeMapping,
  LocalDownloadTreePreview,
  LocalDownloadTreeAction,
  DirectoryDownloadResult,
} from "../../types/download-tree.js";
import type {
  LocalUploadAccess,
  LocalDownloadAccess,
} from "./automated-transfers.js";
export interface DirectoryGrantReference {
  localGrantId: string;
  localVersion: string;
  direction: "upload" | "download";
  overwrite: boolean;
}
/** Private filesystem capability. The task adapter owns policy and identity; native code rechecks its callback at I/O boundaries. */
export interface NativeTaskDirectoryAccess {
  uploadCheckpoint?(): unknown;
  restoreUpload?(checkpoint: unknown): void;
  uploadEntries(): Array<Omit<NativeUploadEntry, "path">>;
  uploadFile(entryId: string): Promise<LocalUploadAccess>;
  previewDownload(
    entries: LocalDownloadTreeMapping[],
  ): Promise<LocalDownloadTreePreview>;
  confirmDownload(
    previewId: string,
    revision: string,
    decisions: Array<{ id: string; action: LocalDownloadTreeAction }>,
  ): LocalDownloadTreePreview;
  createDownloadDirectories(
    previewId: string,
    audit: (type: string, data: Record<string, unknown>) => Promise<void>,
    guard: (entryId?: string) => void,
    entryId?: string,
  ): Promise<DirectoryDownloadResult[]>;
  downloadFile(
    previewId: string,
    entryId: string,
    source: DownloadSource,
  ): Promise<LocalDownloadAccess>;
  downloadState(previewId: string): LocalDownloadTreePreview;
}
export interface NativeDirectoryInspection extends LocalDownloadTreePreview {
  transfers: Array<{ entryId: string; transfer: LocalDownloadView }>;
}
