import { isWindowsSftpPath, sftpPathToLocalPath } from "../transfer-paths.js";

/** Initial directories are terminal input, not shell source. Refuse controls
 * and Windows expansion syntax when the remote shell dialect is unknown. */
export function initialDirectoryCommand(value: string): string {
  if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value))
    throw Error("UNSUPPORTED_TERMINAL_PATH");
  if (isWindowsSftpPath(value)) {
    const native = sftpPathToLocalPath(value);
    if (/[$`%!"[\]*?]/.test(native)) throw Error("UNSUPPORTED_TERMINAL_PATH");
    // pushd changes drives in cmd.exe and also works in PowerShell.
    return 'pushd "' + native + '"\r';
  }
  return "cd -- '" + value.replaceAll("'", "'\\''") + "'\r";
}
