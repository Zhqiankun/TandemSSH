import type { Express } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { SftpFileIO } from "../../files/sftp-io.js";
import { getSessionSftp, type SSHSession } from "./session.js";
/** Human file-browser link inspection; returns metadata, never opens target contents. */
export function registerSymlinkRoute(
  app: Express,
  deps: {
    sshSessions: Record<string, SSHSession>;
    verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
  },
) {
  app.get("/ssh/file_manager/ssh/identifySymlink", async (req, res) => {
    const sessionId = req.query.sessionId,
      linkPath = req.query.path;
    if (
      typeof sessionId !== "string" ||
      typeof linkPath !== "string" ||
      !linkPath ||
      linkPath.length > 4096 ||
      linkPath.includes("\0")
    )
      return res.status(400).json({ error: "FILE_PATH_INVALID" });
    const session = deps.sshSessions[sessionId];
    if (!session?.isConnected)
      return res.status(400).json({ error: "SSH_SESSION_UNAVAILABLE" });
    if (
      !deps.verifySessionOwnership(
        session,
        (req as AuthenticatedRequest).userId,
      )
    )
      return res.status(403).json({ error: "SESSION_ACCESS_DENIED" });
    session.lastActive = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          const io = new SftpFileIO(await getSessionSftp(session), 10000);
          const target = await io.resolve(linkPath);
          if (
            !target.startsWith("/") ||
            target.length > 4096 ||
            target.includes("\0")
          )
            throw Error("FILE_PATH_INVALID");
          const stat = await io.stat(target);
          if (stat.kind !== "file" && stat.kind !== "directory")
            throw Error("FILE_TYPE_UNSUPPORTED");
          return { path: linkPath, target, type: stat.kind };
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error("FILE_IO_TIMEOUT")), 15000);
        }),
      ]);
      if (!res.headersSent && !res.destroyed) res.json(result);
    } catch {
      if (!res.headersSent && !res.destroyed)
        res.status(500).json({ error: "FILE_LINK_RESOLUTION_FAILED" });
    } finally {
      clearTimeout(timer);
    }
  });
}
