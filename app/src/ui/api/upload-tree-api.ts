import { getFileManagerApiForSession } from "@/main-axios";
import type {
  PrepareUploadTree,
  UploadTreePreview,
  UploadTreeAction,
  UploadDirectoryResult,
  UploadFileResult,
} from "@/types/upload-tree";
import type { UploadManifest, UploadView } from "@/types/file-upload";
const prefix = "/ssh/uploads/trees/";
const enc = encodeURIComponent;
export interface UploadTreeApi {
  preview(
    input: PrepareUploadTree,
    signal?: AbortSignal,
  ): Promise<UploadTreePreview>;
  get(session: string, tree: string): Promise<UploadTreePreview>;
  touch(session: string, tree: string, signal?: AbortSignal): Promise<unknown>;
  confirm(
    session: string,
    tree: string,
    revision: string,
    decisions: Array<{ id: string; action: UploadTreeAction }>,
  ): Promise<UploadTreePreview>;
  directories(
    session: string,
    tree: string,
    takeover: boolean,
    signal?: AbortSignal,
  ): Promise<Array<UploadDirectoryResult & { id: string; path: string }>>;
  prepare(
    session: string,
    tree: string,
    entry: string,
    requestId: string,
    manifest: UploadManifest,
    signal: AbortSignal,
  ): Promise<UploadView>;
  complete(
    session: string,
    tree: string,
    entry: string,
    uploadId: string,
  ): Promise<UploadFileResult>;
  cancel(session: string, tree: string): Promise<UploadTreePreview>;
  forget(session: string, tree: string): Promise<unknown>;
}
async function post<T>(
  session: string,
  path: string,
  body: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  return (
    await getFileManagerApiForSession(session).post<T>(prefix + path, body, {
      signal,
      timeout: 0,
    })
  ).data;
}
export const uploadTreeApi: UploadTreeApi = {
  preview: (input, signal) => post(input.sessionId, "preview", input, signal),
  get: async (session, tree) =>
    (
      await getFileManagerApiForSession(session).get<UploadTreePreview>(
        prefix + enc(tree),
        { timeout: 15000 },
      )
    ).data,
  touch: (session, tree, signal) =>
    post(session, enc(tree) + "/touch", {}, signal),
  confirm: (session, tree, revision, decisions) =>
    post(session, enc(tree) + "/confirm", { revision, decisions }),
  directories: (session, tree, takeover, signal) =>
    post(session, enc(tree) + "/directories", { takeover }, signal),
  prepare: (session, tree, entry, requestId, manifest, signal) =>
    post(
      session,
      enc(tree) + "/entries/" + enc(entry) + "/prepare",
      { sessionId: session, requestId, manifest },
      signal,
    ),
  complete: (session, tree, entry, uploadId) =>
    post(session, enc(tree) + "/entries/" + enc(entry) + "/complete", {
      uploadId,
    }),
  cancel: (session, tree) => post(session, enc(tree) + "/cancel"),
  forget: (session, tree) => post(session, enc(tree) + "/forget"),
};
