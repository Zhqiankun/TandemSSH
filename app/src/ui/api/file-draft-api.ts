import { getFileManagerApiForSession } from "@/main-axios";
import type { FileDraftSnapshot, FileDraftWrite } from "@/types/file-draft";
export const fileDraftApi = {
  async read(sessionId: string, version: string, signal?: AbortSignal) {
    return (
      await getFileManagerApiForSession(sessionId).post<{
        draft: FileDraftSnapshot | null;
      }>("/ssh/draft/read", { sessionId, version }, { signal })
    ).data.draft;
  },
  async write(input: FileDraftWrite) {
    return (
      await getFileManagerApiForSession(input.sessionId).post<{
        draft: FileDraftSnapshot;
      }>("/ssh/draft/write", input)
    ).data.draft;
  },
  async remove(sessionId: string, version: string, expectedRevision: string) {
    await getFileManagerApiForSession(sessionId).post("/ssh/draft/remove", {
      sessionId,
      version,
      expectedRevision,
    });
  },
};
export function fileDraftError(error: unknown) {
  const code = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code)
    ? code
    : "FILE_DRAFT_RESPONSE_UNKNOWN";
}
