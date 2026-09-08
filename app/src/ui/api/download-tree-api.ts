import { getFileManagerApiForSession } from "@/main-axios";
import type {
  DownloadTreePreview,
  ScanDownloadTree,
} from "@/types/download-tree";
import type { DownloadSource } from "@/types/file-download";
const prefix = "/ssh/downloads/trees/";
const id = (value: string) => encodeURIComponent(value);
export interface DownloadTreeApi {
  scan(
    input: ScanDownloadTree,
    signal: AbortSignal,
  ): Promise<DownloadTreePreview>;
  touch(
    sessionId: string,
    treeId: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; expiresAt: number }>;
  forget(sessionId: string, treeId: string): Promise<unknown>;
  prepare(
    sessionId: string,
    treeId: string,
    entryId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DownloadSource>;
}
export const downloadTreeApi: DownloadTreeApi = {
  async scan(input, signal) {
    return (
      await getFileManagerApiForSession(input.sessionId).post(
        prefix + "scan",
        input,
        { signal, timeout: 0 },
      )
    ).data;
  },
  async touch(session, tree, signal) {
    return (
      await getFileManagerApiForSession(session).post(
        prefix + id(tree) + "/touch",
        {},
        { signal, timeout: 15000 },
      )
    ).data;
  },
  async forget(session, tree) {
    return (
      await getFileManagerApiForSession(session).post(
        prefix + id(tree) + "/forget",
        {},
        { timeout: 15000 },
      )
    ).data;
  },
  async prepare(session, tree, entry, requestId, signal) {
    return (
      await getFileManagerApiForSession(session).post(
        prefix + id(tree) + "/entries/" + id(entry) + "/prepare",
        { sessionId: session, requestId },
        { signal, timeout: 0 },
      )
    ).data;
  },
};
