import type { DownloadSource, LocalDownloadView } from "@/types/file-download";
export interface ManagedDownloadLifecycle {
  release(): Promise<void>;
  show?(): Promise<void>;
}
export interface ManagedFileDownload extends ManagedDownloadLifecycle {
  kind: "file";
  ready(): boolean;
  overwrite: boolean;
  prepare(
    requestId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<DownloadSource>;
  choose(source: DownloadSource): Promise<LocalDownloadView>;
  complete(source: DownloadSource, local: LocalDownloadView): Promise<void>;
}
export interface ManagedDownloadRecord extends ManagedDownloadLifecycle {
  kind: "record";
  retry?(): Promise<void>;
}
export type ManagedDownloadBinding =
  ManagedFileDownload | ManagedDownloadRecord;
