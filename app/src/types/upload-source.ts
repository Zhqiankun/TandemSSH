import type { DownloadNativeResult } from "./file-download.js";
export interface NativeUploadEntry {
  id: string;
  parentId?: string;
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory" | "link" | "other";
  size: number;
  lastModified: number;
  error?: string;
}
export interface NativeUploadSelection {
  id: string;
  entries: NativeUploadEntry[];
  bytes: number;
  excluded: number;
}
export interface DesktopUploadSourceApi {
  chooseDirectory(): Promise<
    DownloadNativeResult<NativeUploadSelection | null>
  >;
  fromFiles(
    files: File[],
  ): Promise<DownloadNativeResult<NativeUploadSelection>>;
  check(
    id: string,
    entryId: string,
  ): Promise<DownloadNativeResult<NativeUploadEntry>>;
  chunk(
    id: string,
    entryId: string,
    offset: number,
    length: number,
  ): Promise<DownloadNativeResult<Uint8Array>>;
  forget(id: string): Promise<DownloadNativeResult<null>>;
  reset(): Promise<DownloadNativeResult<null>>;
}
export interface UploadSource {
  name: string;
  size: number;
  lastModified: number;
  slice(start: number, end: number): Blob | Promise<Blob>;
  verify?(): Promise<void>;
}
