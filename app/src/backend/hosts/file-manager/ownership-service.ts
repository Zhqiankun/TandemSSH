import type { SSHSession } from "./session.js";
import { execChannel, getSessionSftp } from "./session.js";
import { SftpFileIO } from "../../files/sftp-io.js";
/** One explicit human ownership change. No elevation, retries or chmod restoration. */
export async function changeFileOwnership(
  session: SSHSession,
  path: string,
  uid: number,
  gid: number,
) {
  const literal = "'" + path.replaceAll("'", "'\\''") + "'";
  let active = true;
  let channel: import("ssh2").ClientChannel | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await new Promise<void>((resolve, reject) => {
          execChannel(
            session,
            `chown -h -- ${uid}:${gid} ${literal}`,
            (error, stream) => {
              if (!active) {
                stream?.close();
                return;
              }
              if (error) {
                reject(Error("FILE_OWNERSHIP_FAILED"));
                return;
              }
              channel = stream;
              stream.on("data", () => {});
              stream.stderr.on("data", () => {});
              stream.once("error", () =>
                reject(Error("FILE_OWNERSHIP_FAILED")),
              );
              stream.once("close", (code) =>
                code === 0 ? resolve() : reject(Error("FILE_OWNERSHIP_FAILED")),
              );
            },
            () => {
              if (!active) throw Error("FILE_OWNERSHIP_UNCONFIRMED");
            },
          );
        });
        if (!active) throw Error("FILE_OWNERSHIP_UNCONFIRMED");
        const io = new SftpFileIO(await getSessionSftp(session), 5000);
        if (!active) throw Error("FILE_OWNERSHIP_UNCONFIRMED");
        const result = await io.stat(path);
        if (result.uid !== uid || result.gid !== gid)
          throw Error("FILE_OWNERSHIP_UNCONFIRMED");
        return {
          success: true as const,
          uid: result.uid,
          gid: result.gid,
          mode: result.mode,
        };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("FILE_OWNERSHIP_UNCONFIRMED")),
          15000,
        );
      }),
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
    channel?.close();
  }
}
