import type { UploadManifest, UploadView } from "@/types/file-upload";
interface UploadLifecycle {
  release(): Promise<void>;
}
export interface ManagedFileUpload extends UploadLifecycle {
  kind: "file";
  ready(): boolean;
  overwrite: boolean;
  takeover: boolean;
  prepare(
    requestId: string,
    sessionId: string,
    manifest: UploadManifest,
    signal: AbortSignal,
  ): Promise<UploadView>;
}
export interface ManagedUploadRecord extends UploadLifecycle {
  kind: "record";
  retry?(takeover: boolean): Promise<void>;
}
export type ManagedUploadBinding = ManagedFileUpload | ManagedUploadRecord;
