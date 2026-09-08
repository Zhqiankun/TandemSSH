import { getFileManagerApiForSession } from "@/main-axios";
import type {
  PrepareUpload,
  UploadView,
  StartUpload,
} from "@/types/file-upload";
export interface UploadApiPort {
  prepare(input: PrepareUpload, signal?: AbortSignal): Promise<UploadView>;
  start(
    sessionId: string,
    id: string,
    input: StartUpload,
    signal?: AbortSignal,
  ): Promise<UploadView>;
  chunk(
    sessionId: string,
    id: string,
    offset: number,
    bytes: Blob,
    signal?: AbortSignal,
  ): Promise<UploadView>;
  action(
    sessionId: string,
    id: string,
    action: "pause" | "resume" | "finish" | "cancel",
    input?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<UploadView>;
}
const prefix = "/ssh/uploads";
export const uploadApi: UploadApiPort = {
  async prepare(input, signal) {
    return (
      await getFileManagerApiForSession(input.sessionId).post<UploadView>(
        prefix + "/prepare",
        input,
        { signal, timeout: 0 },
      )
    ).data;
  },
  async start(sessionId, id, input, signal) {
    return (
      await getFileManagerApiForSession(sessionId).post<UploadView>(
        prefix + "/" + encodeURIComponent(id) + "/start",
        input,
        { signal, timeout: 0 },
      )
    ).data;
  },
  async chunk(sessionId, id, offset, bytes, signal) {
    return (
      await getFileManagerApiForSession(sessionId).post<UploadView>(
        prefix + "/" + encodeURIComponent(id) + "/chunk",
        bytes,
        {
          params: { offset },
          headers: { "Content-Type": "application/octet-stream" },
          signal,
          timeout: 0,
        },
      )
    ).data;
  },
  async action(sessionId, id, action, input = {}, signal) {
    return (
      await getFileManagerApiForSession(sessionId).post<UploadView>(
        prefix + "/" + encodeURIComponent(id) + "/" + action,
        input,
        { signal, timeout: 0 },
      )
    ).data;
  },
};
export function uploadErrorCode(error: unknown) {
  const server = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof server === "string"
    ? server
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "UPLOAD_FAILED";
}
