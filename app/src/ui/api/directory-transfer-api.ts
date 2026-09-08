import { authApi } from "@/main-axios";
import type {
  DirectoryAction,
  DirectoryChoice,
  DirectoryPreviewView,
  DirectoryPreviewPage,
  DirectoryRunView,
} from "@/types/directory-transfer";
const route = (taskId: string) =>
  "/tandem/directories/tasks/" + encodeURIComponent(taskId);
export const directoryTransferApi = {
  snapshot: async (taskId: string, signal?: AbortSignal) =>
    (
      await authApi.get<{
        previews: DirectoryPreviewView[];
        runs: DirectoryRunView[];
      }>(route(taskId), { signal })
    ).data,
  page: async (
    taskId: string,
    previewId: string,
    offset = 0,
    signal?: AbortSignal,
  ) =>
    (
      await authApi.get<DirectoryPreviewPage>(
        route(taskId) + "/previews/" + encodeURIComponent(previewId),
        { params: { offset }, signal },
      )
    ).data,
  preview: async (
    taskId: string,
    input: Omit<
      Extract<DirectoryAction, { type: "file.directory.preview" }>,
      "type" | "canonicalPath"
    > & { requestId: string },
  ) =>
    (
      await authApi.post<{ operationId: string; status: string }>(
        route(taskId) + "/previews",
        input,
      )
    ).data,
  run: async (
    taskId: string,
    input: {
      previewId: string;
      revision: string;
      choices: Array<{ id: string; action: DirectoryChoice }>;
      requestId: string;
    },
  ) =>
    (await authApi.post<DirectoryRunView>(route(taskId) + "/runs", input)).data,
  release: async (taskId: string, previewId: string) =>
    (
      await authApi.post(
        route(taskId) +
          "/previews/" +
          encodeURIComponent(previewId) +
          "/release",
        {},
      )
    ).data,
};
