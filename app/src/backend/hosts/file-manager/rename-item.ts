import type { SFTPWrapper } from "ssh2";
import { isWindowsSftpPath } from "../transfer-paths.js";
const missing = (error: unknown) => {
  const code = (error as { code?: string | number })?.code;
  return code === 2 || code === "ENOENT";
};
function request<T>(
  start: (done: (error: Error | undefined | null, value?: T) => void) => void,
  timeoutCode: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(timeoutCode)), 10000);
    try {
      start((error, value) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value!);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
export async function renameFileItem(
  sftp: SFTPWrapper,
  oldPath: string,
  newName: string,
): Promise<string> {
  if (
    typeof oldPath !== "string" ||
    !oldPath.length ||
    oldPath.includes("\0") ||
    typeof newName !== "string" ||
    !newName.length ||
    newName.includes("\0") ||
    newName.includes("/") ||
    [".", ".."].includes(newName) ||
    (isWindowsSftpPath(oldPath) && newName.includes("\\"))
  )
    throw Error("INVALID_RENAME_PATH");
  if (isWindowsSftpPath(oldPath)) oldPath = oldPath.replaceAll("\\", "/");
  const target = oldPath.slice(0, oldPath.lastIndexOf("/") + 1) + newName;
  await request((done) => sftp.lstat(oldPath, done), "FILE_READ_TIMEOUT");
  if (target === oldPath) return target;
  try {
    await request((done) => sftp.lstat(target, done), "FILE_READ_TIMEOUT");
    throw Error("FILE_TARGET_EXISTS");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  // Standard SFTP v3 RENAME refuses an existing destination. Do not substitute
  // ext_openssh_rename (overwrite) or a shell mv fallback after a failure.
  try {
    await request<void>(
      (done) => sftp.rename(oldPath, target, done),
      "RENAME_RESULT_UNKNOWN",
    );
  } catch (error) {
    if ((error as Error).message === "RENAME_RESULT_UNKNOWN") throw error;
    const code = (error as { code?: number }).code;
    if (code === undefined || code === 6 || code === 7)
      throw Error("RENAME_RESULT_UNKNOWN");
    if (code !== 4) throw error;
    try {
      await request((done) => sftp.lstat(target, done), "FILE_READ_TIMEOUT");
    } catch {
      throw error;
    }
    throw Error("FILE_TARGET_EXISTS");
  }
  return target;
}
