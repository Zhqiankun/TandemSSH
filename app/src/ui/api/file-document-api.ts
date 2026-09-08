import { getFileManagerApiForSession } from "@/main-axios";
import { writeSSHFile } from "./ssh-file-operations-api";
import type {
  FileCharset,
  FileDocumentContent,
  FileDocumentFailure,
} from "@/types/file-document";
export const fileDocumentApi = {
  async read(
    sessionId: string,
    path: string,
    charset?: FileCharset,
    signal?: AbortSignal,
  ) {
    // An editor owns its own baseline and connection lease; never share a preview cache entry.
    const response = await getFileManagerApiForSession(
      sessionId,
    ).get<FileDocumentContent>("/ssh/readFile", {
      params: { sessionId, path, charset, editor: "true" },
      signal,
    });
    return response.data;
  },
  save: writeSSHFile,
  async close(sessionId: string, documentId: string) {
    await getFileManagerApiForSession(sessionId).post("/ssh/closeDocument", {
      documentId,
    });
  },
};
export function fileDocumentFailure(error: unknown): FileDocumentFailure {
  const response = (error as { response?: { data?: FileDocumentFailure } })
    ?.response;
  if (
    response?.data &&
    typeof response.data.error === "string" &&
    /^[A-Z][A-Z0-9_]+$/.test(response.data.error)
  )
    return response.data;
  return { error: "FILE_RESPONSE_UNKNOWN", commitMayHaveOccurred: true };
}
