import { registerUploadRoutes } from "./upload-routes.js";
import { uploadTransfers } from "../../files/production.js";
import { registerDocumentRoutes } from "./document-routes.js";
import type { Express } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { fileLogger } from "../../utils/logger.js";
import { execChannel, type SSHSession } from "./session.js";

type FileContentRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileContentRoutes(
  app: Express,
  { sshSessions, verifySessionOwnership }: FileContentRoutesDeps,
): void {
  registerDocumentRoutes(app, sshSessions);
  registerUploadRoutes(app, uploadTransfers);
  /**
   * @openapi
   * /ssh/file_manager/ssh/identifySymlink:
   *   get:
   *     summary: Identify symbolic link
   *     description: Identifies the target of a symbolic link.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Symbolic link information.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       500:
   *         description: Failed to identify symbolic link.
   */
  app.get("/ssh/file_manager/ssh/identifySymlink", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const linkPath = decodeURIComponent(req.query.path as string);
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!linkPath) {
      return res.status(400).json({ error: "Link path is required" });
    }

    sshConn.lastActive = Date.now();

    const escapedPath = linkPath.replace(/'/g, "'\"'\"'");
    const command = `stat -L -c "%F" '${escapedPath}' && readlink -f '${escapedPath}'`;

    execChannel(sshConn, command, (err, stream) => {
      if (err) {
        fileLogger.error("SSH identifySymlink error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        if (code !== 0) {
          fileLogger.error(
            `SSH identifySymlink command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res
            .status(500)
            .json({ error: `Command failed: ${errorData}` });
        }

        const [fileType, target] = data.trim().split("\n");

        res.json({
          path: linkPath,
          target: target,
          type: fileType.toLowerCase().includes("directory")
            ? "directory"
            : "file",
        });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH identifySymlink stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/resolvePath:
   *   get:
   *     summary: Resolve a path with environment variables
   *     description: Expands environment variables and ~ in a path via the SSH session.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The resolved absolute path.
   *       400:
   *         description: Missing required parameters.
   *       500:
   *         description: Failed to resolve path.
   */
  app.get("/ssh/file_manager/ssh/resolvePath", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const rawPath = decodeURIComponent(req.query.path as string);
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!rawPath) {
      return res.status(400).json({ error: "Path is required" });
    }

    sshConn.lastActive = Date.now();

    let command: string;
    if (rawPath.startsWith("~")) {
      const rest = rawPath.substring(1).replace(/'/g, "'\"'\"'");
      command = `echo ~'${rest}'`;
    } else {
      const escapedPath = rawPath.replace(/'/g, "'\"'\"'");
      command = `echo '${escapedPath}'`;
    }

    execChannel(sshConn, command, (err, stream) => {
      if (err) {
        fileLogger.error("SSH resolvePath error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        if (code !== 0) {
          fileLogger.error(
            `SSH resolvePath command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res.json({ resolvedPath: rawPath });
        }

        const resolved = data.trim();
        res.json({ resolvedPath: resolved || rawPath });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH resolvePath stream error:", streamErr);
        if (!res.headersSent) {
          res.json({ resolvedPath: rawPath });
        }
      });
    });
  });
}
