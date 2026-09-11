import type { SFTPWrapper, ClientChannel } from "ssh2";
import { execChannel, type SSHSession } from "./session.js";
import { isWindowsSftpPath } from "../transfer-paths.js";
export function buildNoClobberMoveCommand(
  source: string,
  target: string,
): string {
  if (
    [source, target].some(
      (path) => typeof path !== "string" || !path.length || path.includes("\0"),
    )
  )
    throw Error("INVALID_MOVE_PATH");
  if (isWindowsSftpPath(source) || isWindowsSftpPath(target))
    throw Error("MOVE_CROSS_DEVICE_UNSUPPORTED");
  const quote = (path: string) => "'" + path.replaceAll("'", "'\"'\"'") + "'";
  return `mv -n -T -- ${quote(source)} ${quote(target)}`;
}
async function exists(sftp: SFTPWrapper, path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("MOVE_RESULT_UNKNOWN")), 10000);
    try {
      sftp.lstat(path, (error) => {
        clearTimeout(timer);
        if (!error) resolve(true);
        else if ((error as { code?: number }).code === 2) resolve(false);
        else reject(Error("MOVE_RESULT_UNKNOWN"));
      });
    } catch {
      clearTimeout(timer);
      reject(Error("MOVE_RESULT_UNKNOWN"));
    }
  });
}
/** Manual file move only, on the already authenticated connection. No sudo,
 * overwrite fallback, retry or new SSH connection is allowed. */
export async function moveWithNoClobber(
  session: SSHSession,
  sftp: SFTPWrapper,
  source: string,
  target: string,
): Promise<void> {
  const command = buildNoClobberMoveCommand(source, target);
  if (await exists(sftp, target)) throw Error("FILE_TARGET_EXISTS");
  const code = await new Promise<number | null>((resolve, reject) => {
    let channel: ClientChannel | undefined,
      ended = false;
    const finish = (value: number | null) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(null);
      channel?.destroy();
    }, 60000);
    execChannel(
      session,
      command,
      (error, stream) => {
        if (error) {
          if (!ended) {
            ended = true;
            clearTimeout(timer);
            reject(Error("MOVE_RESULT_UNKNOWN"));
          }
          return;
        }
        channel = stream;
        if (ended) {
          stream.destroy();
          return;
        }
        stream.on("data", () => {});
        stream.stderr.on("data", () => {});
        stream.once("error", () => {
          finish(null);
          stream.destroy();
        });
        stream.once("close", (exitCode: number) =>
          finish(Number.isInteger(exitCode) ? exitCode : null),
        );
      },
      () => {
        if (ended || !session.isConnected) throw Error("MOVE_RESULT_UNKNOWN");
      },
    );
  });
  if (code !== 0) throw Error("MOVE_RESULT_UNKNOWN");
  const sourceExists = await exists(sftp, source),
    targetExists = await exists(sftp, target);
  if (sourceExists && targetExists) throw Error("FILE_TARGET_EXISTS");
  if (sourceExists || !targetExists) throw Error("MOVE_RESULT_UNKNOWN");
}
