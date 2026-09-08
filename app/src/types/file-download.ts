export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const DOWNLOAD_MAX_CHUNKS = 16384;
export interface DownloadSource {
  id: string;
  sessionId: string;
  path: string;
  canonicalPath: string;
  hostIdentity?: string;
  size: number;
  sha256: string;
  hashes: string[];
  chunkBytes: number;
  state: "ready" | "paused" | "verified" | "cancelled";
  expiresAt: number;
}
export interface PrepareDownload {
  requestId: string;
  sessionId: string;
  path: string;
}
export interface LocalDownloadSpec {
  name: string;
  size: number;
  sha256: string;
  hashes: string[];
}
export interface LocalDownloadView {
  id: string;
  path: string;
  temporaryPath?: string;
  size: number;
  writtenBytes: number;
  existing?: { size: number; modifiedAt: number };
  state:
    | "preview"
    | "writing"
    | "paused"
    | "completed"
    | "failed"
    | "unknown"
    | "cancelled";
  sha256?: string;
  error?: string;
}
export type DownloadNativeResult<T> =
  { ok: true; value: T } | { ok: false; error: string };
export interface DesktopDownloadApi {
  choose(
    spec: LocalDownloadSpec,
  ): Promise<DownloadNativeResult<LocalDownloadView | null>>;
  start(
    id: string,
    overwrite: boolean,
  ): Promise<DownloadNativeResult<LocalDownloadView>>;
  append(
    id: string,
    offset: number,
    bytes: Uint8Array,
  ): Promise<DownloadNativeResult<LocalDownloadView>>;
  action(
    id: string,
    action: "pause" | "resume" | "finish" | "cancel" | "show" | "forget",
  ): Promise<DownloadNativeResult<LocalDownloadView>>;
  reset(): Promise<DownloadNativeResult<null>>;
}
