import { getFileManagerApiForSession } from "@/main-axios";
import type {
  DownloadSource,
  PrepareDownload,
  DownloadNativeResult,
} from "@/types/file-download";
export interface DownloadApiPort {
  prepare(input: PrepareDownload, signal: AbortSignal): Promise<DownloadSource>;
  chunk(
    sessionId: string,
    id: string,
    offset: number,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  action(
    sessionId: string,
    id: string,
    action: "pause" | "resume" | "verify" | "cancel",
    signal?: AbortSignal,
  ): Promise<DownloadSource>;
}
const prefix = "/ssh/downloads/";
export const downloadApi: DownloadApiPort = {
  async prepare(input, signal) {
    return (
      await getFileManagerApiForSession(input.sessionId).post(
        prefix + "prepare",
        input,
        { signal, timeout: 0 },
      )
    ).data;
  },
  async chunk(sessionId, id, offset, signal) {
    const response = await getFileManagerApiForSession(sessionId).get(
      prefix + encodeURIComponent(id) + "/chunk",
      { params: { offset }, responseType: "arraybuffer", signal, timeout: 0 },
    );
    return new Uint8Array(response.data);
  },
  async action(sessionId, id, action, signal) {
    return (
      await getFileManagerApiForSession(sessionId).post(
        prefix + encodeURIComponent(id) + "/" + action,
        action === "resume" ? { sessionId } : {},
        { signal, timeout: 0 },
      )
    ).data;
  },
};
export function downloadErrorCode(error: unknown): string {
  const code = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof code === "string"
    ? code
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "DOWNLOAD_FAILED";
}
export function nativeDownloadValue<T>(result: DownloadNativeResult<T>): T {
  if (result.ok === false) throw Error(result.error);
  return result.value;
}
