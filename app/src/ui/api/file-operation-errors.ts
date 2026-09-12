import axios from "axios";
import { handleApiError } from "@/main-axios";
const fileResultCodes = new Set([
  "TRASH_RESULT_UNKNOWN",
  "FILE_TARGET_EXISTS",
  "CREATE_RESULT_UNKNOWN",
  "INVALID_CREATE_PATH",
  "COPY_RESULT_UNKNOWN",
  "INVALID_COPY_REQUEST",
  "COPY_NOT_DISPATCHED",
  "MOVE_RESULT_UNKNOWN",
  "MOVE_CROSS_DEVICE_UNSUPPORTED",
  "INVALID_MOVE_PATH",
  "RENAME_RESULT_UNKNOWN",
  "INVALID_RENAME_PATH",
]);
/** Keep file-operation result codes across the HTTP adapter without retaining
 * the Axios request configuration or authorization headers on the thrown error. */
export function throwFileOperationError(
  error: unknown,
  operation: string,
): never {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.error;
    if (
      [400, 409, 500].includes(error.response?.status ?? 0) &&
      typeof code === "string" &&
      fileResultCodes.has(code)
    ) {
      throw Object.assign(new Error(code), {
        response: { status: error.response?.status, data: { error: code } },
      });
    }
  }
  return handleApiError(error, operation);
}
