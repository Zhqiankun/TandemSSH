import type { SFTPWrapper } from "ssh2";
import { isWindowsSftpPath } from "../transfer-paths.js";

export function newItemPath(directory: string, name: string): string {
  if (
    typeof directory !== "string" ||
    !directory ||
    directory.includes("\0") ||
    typeof name !== "string" ||
    !name ||
    name.includes("\0") ||
    name.includes("/") ||
    name === "." ||
    name === ".." ||
    (isWindowsSftpPath(directory) && name.includes("\\"))
  )
    throw Error("INVALID_CREATE_PATH");
  if (isWindowsSftpPath(directory)) directory = directory.replaceAll("\\", "/");
  return directory.replace(/\/$/, "") + "/" + name;
}
function request<T>(
  start: (done: (error: Error | null | undefined, result?: T) => void) => void,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(Error("CREATE_RESULT_UNKNOWN"));
    }, 10000);
    try {
      start((error, value) => {
        clearTimeout(timer);
        if (expired) {
          if (!error && value !== undefined) late?.(value);
          return;
        }
        if (error) reject(error);
        else resolve(value!);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
/** Create one entry exclusively. Never touch, truncate, merge or replace an existing entry. */
export async function createFileItem(
  sftp: SFTPWrapper,
  directory: string,
  name: string,
  kind: "file" | "directory",
): Promise<string> {
  const target = newItemPath(directory, name);
  try {
    if (kind === "directory")
      await request<void>((done) => sftp.mkdir(target, done));
    else {
      const handle = await request<Buffer>(
        (done) => sftp.open(target, "wx", done),
        (handle) => {
          try {
            sftp.close(handle, () => {});
          } catch {
            /* The session may already be gone. */
          }
        },
      );
      try {
        await request<void>((done) => sftp.close(handle, done));
      } catch {
        throw Error("CREATE_RESULT_UNKNOWN");
      }
    }
  } catch (error) {
    if ((error as Error).message === "CREATE_RESULT_UNKNOWN") throw error;
    const code = (error as { code?: number }).code;
    if (code === 4 || code === 11) {
      let exists = false;
      try {
        await request((done) => sftp.lstat(target, done));
        exists = true;
      } catch {
        /* preserve original server failure */
      }
      if (exists) throw Error("FILE_TARGET_EXISTS");
    }
    if (code === undefined || code === 6 || code === 7)
      throw Error("CREATE_RESULT_UNKNOWN");
    throw error;
  }
  return target;
}
