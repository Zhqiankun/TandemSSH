import { authApi } from "@/main-axios";
import type {
  HumanLocalFileGrant,
  LocalFileTicket,
} from "@/types/local-file-grants";
const path = (task: string) =>
  "/tandem/local-files/tasks/" + encodeURIComponent(task);
export const localFileGrantsApi = {
  list: async (task: string, signal?: AbortSignal) =>
    (
      await authApi.get<{ available: boolean; grants: HumanLocalFileGrant[] }>(
        path(task),
        { signal },
      )
    ).data,
  ticket: async (
    task: string,
    input: {
      windowToken: string;
      direction: "upload" | "download";
      allowOverwrite: boolean;
    },
    signal?: AbortSignal,
  ) =>
    (
      await authApi.post<LocalFileTicket>(path(task) + "/tickets", input, {
        signal,
      })
    ).data,
  cancel: async (task: string, ticket: string) => {
    await authApi.post(
      path(task) + "/tickets/" + encodeURIComponent(ticket) + "/cancel",
      {},
    );
  },
  action: async (task: string, id: string, action: "revoke" | "forget") => {
    await authApi.post(
      path(task) + "/grants/" + encodeURIComponent(id) + "/" + action,
      {},
    );
  },
};
export function localFileError(error: unknown) {
  const value = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof value === "string"
    ? value
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "FILE_LOCAL_REQUEST_FAILED";
}
