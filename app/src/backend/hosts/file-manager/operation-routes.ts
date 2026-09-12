import { createFileItem, newItemPath } from "./create-item.js";
import { moveWithNoClobber } from "./move-command.js";
import { renameFileItem, moveFileItem } from "./rename-item.js";
import type { Express } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { fileLogger } from "../../utils/logger.js";
import {
  execChannel,
  execWithSudo,
  getSessionSftp,
  type SSHSession,
} from "./session.js";
import {
  buildDeleteCommand,
  fileCommandSucceeded,
} from "./operation-commands.js";
import {
  emptyTrash,
  listTrash,
  moveToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "./trash-service.js";
import {
  createCurrentSettingsRepository,
  getCurrentSettingValue,
} from "../../database/repositories/factory.js";
import { PermissionManager } from "../../utils/permission-manager.js";

type FileOperationRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileOperationRoutes(
  app: Express,
  { sshSessions, verifySessionOwnership }: FileOperationRoutesDeps,
): void {
  const permissionManager = PermissionManager.getInstance();
  const getTrashRetentionDays = () => {
    try {
      const value = Number(
        getCurrentSettingValue("file_manager_trash_retention_days"),
      );
      return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 7;
    } catch {
      return 7;
    }
  };

  async function ownedSession(
    req: AuthenticatedRequest,
    res: import("express").Response,
  ) {
    const sessionId = String(req.body?.sessionId ?? req.query?.sessionId ?? "");
    const session = sshSessions[sessionId];
    if (!sessionId || !session?.isConnected) {
      res.status(400).json({ error: "SSH connection not established" });
      return null;
    }
    if (!verifySessionOwnership(session, req.userId)) {
      res.status(403).json({ error: "Session access denied" });
      return null;
    }
    session.lastActive = Date.now();
    return session;
  }

  app.get("/ssh/file_manager/ssh/trash", async (req, res) => {
    const session = await ownedSession(
      req as unknown as AuthenticatedRequest,
      res,
    );
    if (!session) return;
    try {
      res.json({
        items: await listTrash(
          await getSessionSftp(session),
          getTrashRetentionDays(),
        ),
        retentionDays: getTrashRetentionDays(),
        canManageRetention: await permissionManager.isAdmin(
          (req as AuthenticatedRequest).userId,
        ),
      });
    } catch (error) {
      fileLogger.error("Failed to list trash", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/ssh/file_manager/ssh/trash/:id/restore", async (req, res) => {
    const session = await ownedSession(
      req as unknown as AuthenticatedRequest,
      res,
    );
    if (!session) return;
    try {
      res.json({
        item: await restoreTrashItem(
          await getSessionSftp(session),
          req.params.id,
        ),
      });
    } catch (error) {
      const message = (error as Error).message;
      res
        .status(message.includes("already exists") ? 409 : 500)
        .json({ error: message });
    }
  });

  app.delete("/ssh/file_manager/ssh/trash/:id", async (req, res) => {
    const session = await ownedSession(
      req as unknown as AuthenticatedRequest,
      res,
    );
    if (!session) return;
    try {
      await permanentlyDeleteTrashItem(
        await getSessionSftp(session),
        req.params.id,
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/ssh/file_manager/ssh/trash", async (req, res) => {
    const session = await ownedSession(req as AuthenticatedRequest, res);
    if (!session) return;
    try {
      res.json({ deleted: await emptyTrash(await getSessionSftp(session)) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/ssh/file_manager/ssh/trash-retention", async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!(await permissionManager.isAdmin(userId))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const retentionDays = Number(req.body?.retentionDays);
    if (
      !Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      return res
        .status(400)
        .json({ error: "Retention must be between 1 and 3650 days" });
    }
    await createCurrentSettingsRepository().upsert(
      "file_manager_trash_retention_days",
      String(retentionDays),
    );
    return res.json({ retentionDays });
  });
  /**
   * @openapi
   * /ssh/file_manager/ssh/createFile:
   *   post:
   *     summary: Create a file
   *     description: Creates an empty file on the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               path:
   *                 type: string
   *               fileName:
   *                 type: string
   *     responses:
   *       200:
   *         description: File created successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to create file.
   */
  app.post("/ssh/file_manager/ssh/createFile", async (req, res) => {
    const { sessionId, path: directory, fileName: name } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId)
      return res.status(400).json({ error: "INVALID_CREATE_PATH" });
    const session = sshSessions[sessionId];
    if (!session?.isConnected)
      return res.status(400).json({ error: "SSH connection not established" });
    if (!verifySessionOwnership(session, (req as AuthenticatedRequest).userId))
      return res.status(403).json({ error: "Session access denied" });
    try {
      newItemPath(directory, name);
      session.lastActive = Date.now();
      const target = await createFileItem(
        await getSessionSftp(session),
        directory,
        name,
        "file",
      );
      return res.json({ message: "Item created successfully", path: target });
    } catch (error) {
      const code = (error as { code?: number }).code;
      const message = (error as Error).message;
      return res
        .status(
          message === "INVALID_CREATE_PATH"
            ? 400
            : message === "FILE_TARGET_EXISTS"
              ? 409
              : code === 3
                ? 403
                : 500,
        )
        .json({ error: message });
    }
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/createFolder:
   *   post:
   *     summary: Create a folder
   *     description: Creates a new folder on the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               path:
   *                 type: string
   *               folderName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Folder created successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to create folder.
   */
  app.post("/ssh/file_manager/ssh/createFolder", async (req, res) => {
    const { sessionId, path: directory, folderName: name } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId)
      return res.status(400).json({ error: "INVALID_CREATE_PATH" });
    const session = sshSessions[sessionId];
    if (!session?.isConnected)
      return res.status(400).json({ error: "SSH connection not established" });
    if (!verifySessionOwnership(session, (req as AuthenticatedRequest).userId))
      return res.status(403).json({ error: "Session access denied" });
    try {
      newItemPath(directory, name);
      session.lastActive = Date.now();
      const target = await createFileItem(
        await getSessionSftp(session),
        directory,
        name,
        "directory",
      );
      return res.json({ message: "Item created successfully", path: target });
    } catch (error) {
      const code = (error as { code?: number }).code;
      const message = (error as Error).message;
      return res
        .status(
          message === "INVALID_CREATE_PATH"
            ? 400
            : message === "FILE_TARGET_EXISTS"
              ? 409
              : code === 3
                ? 403
                : 500,
        )
        .json({ error: message });
    }
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/deleteItem:
   *   delete:
   *     summary: Delete a file or directory
   *     description: Deletes a file or directory on the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               path:
   *                 type: string
   *               isDirectory:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Item deleted successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to delete item.
   */
  app.delete("/ssh/file_manager/ssh/deleteItem", async (req, res) => {
    const { sessionId, path: itemPath, isDirectory, permanent } = req.body;
    const sshConn = sshSessions[sessionId];
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

    if (
      typeof itemPath !== "string" ||
      !itemPath.length ||
      itemPath.includes("\0")
    ) {
      return res.status(400).json({ error: "INVALID_FILE_PATH" });
    }
    if (
      (permanent !== undefined && typeof permanent !== "boolean") ||
      (isDirectory !== undefined && typeof isDirectory !== "boolean")
    ) {
      return res.status(400).json({ error: "INVALID_DELETE_OPTIONS" });
    }

    fileLogger.info("Deleting item", {
      operation: "file_delete",
      sessionId,
      userId,
      path: itemPath,
      type: isDirectory ? "directory" : "file",
    });
    sshConn.lastActive = Date.now();

    if (!permanent) {
      let moveAttempted = false;
      try {
        const sftp = await getSessionSftp(sshConn);
        await listTrash(sftp, getTrashRetentionDays());
        moveAttempted = true;
        const item = await moveToTrash(sftp, itemPath);
        fileLogger.success("Item moved to trash", {
          operation: "file_trash_success",
          sessionId,
          userId,
          path: itemPath,
          trashId: item.id,
        });
        return res.json({
          message: "Item moved to trash",
          path: itemPath,
          trashItem: item,
        });
      } catch (error) {
        fileLogger.error("Failed to move item to trash", error, {
          operation: "file_trash_failed",
          sessionId,
          userId,
          path: itemPath,
        });
        return res.status(moveAttempted ? 500 : 409).json({
          error: moveAttempted
            ? "TRASH_RESULT_UNKNOWN"
            : (error as Error).message,
          trashUnavailable: !moveAttempted,
        });
      }
    }

    const { command: deleteCommand, commandWithSuccess } = buildDeleteCommand(
      itemPath,
      Boolean(isDirectory),
    );

    const executeDelete = (useSudo: boolean): Promise<void> => {
      return new Promise((resolve) => {
        if (useSudo && sshConn.sudoPassword) {
          execWithSudo(sshConn, deleteCommand, sshConn.sudoPassword).then(
            (result) => {
              if (fileCommandSucceeded(result.code)) {
                res.json({
                  message: "Item deleted successfully",
                  path: itemPath,
                  toast: {
                    type: "success",
                    message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                  },
                });
              } else {
                res.status(500).json({
                  error: `Delete failed: ${result.stderr || result.stdout}`,
                });
              }
              resolve();
            },
            () => {
              res.status(500).json({ error: "SUDO_DELETE_FAILED" });
              resolve();
            },
          );
          return;
        }

        execChannel(sshConn, commandWithSuccess, (err, stream) => {
          if (err) {
            fileLogger.error("SSH deleteItem error:", err);
            res.status(500).json({ error: err.message });
            resolve();
            return;
          }

          let outputData = "";
          let errorData = "";
          let settled = false;

          stream.on("data", (chunk: Buffer) => {
            outputData += chunk.toString();
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
          });

          stream.on("close", (code) => {
            if (settled) return;
            settled = true;
            if (
              typeof code === "number" &&
              code !== 0 &&
              /permission denied/i.test(errorData)
            ) {
              if (sshConn.sudoPassword) {
                executeDelete(true).then(resolve);
                return;
              }
              fileLogger.error(`Permission denied deleting: ${itemPath}`);
              res.status(403).json({
                error: `Permission denied: Cannot delete ${itemPath}.`,
                needsSudo: true,
              });
              resolve();
              return;
            }

            if (fileCommandSucceeded(code, outputData)) {
              fileLogger.success("Item deleted successfully", {
                operation: "file_delete_success",
                sessionId,
                userId,
                path: itemPath,
              });
              res.json({
                message: "Item deleted successfully",
                path: itemPath,
                toast: {
                  type: "success",
                  message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                },
              });
            } else {
              const detail =
                errorData.trim() ||
                outputData.trim() ||
                `command exited with code ${code} and produced no output (the remote shell may not support the delete command)`;
              fileLogger.error(`Delete failed for ${itemPath}: ${detail}`, {
                operation: "file_delete_failed",
                sessionId,
                userId,
                path: itemPath,
              });
              res.status(500).json({
                error: `Delete failed: ${detail}`,
              });
            }
            resolve();
          });

          stream.on("error", (streamErr) => {
            if (settled) return;
            settled = true;
            fileLogger.error("SSH deleteItem stream error:", streamErr);
            res
              .status(500)
              .json({ error: `Stream error: ${streamErr.message}` });
            resolve();
          });
        });
      });
    };

    await executeDelete(false);
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/renameItem:
   *   put:
   *     summary: Rename a file or directory
   *     description: Renames a file or directory on the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               oldPath:
   *                 type: string
   *               newName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Item renamed successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to rename item.
   */
  app.put("/ssh/file_manager/ssh/renameItem", async (req, res) => {
    const { sessionId, oldPath, newName } = req.body;
    const sshConn = sshSessions[sessionId];
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

    if (
      typeof oldPath !== "string" ||
      typeof newName !== "string" ||
      !oldPath ||
      !newName
    ) {
      return res
        .status(400)
        .json({ error: "Old path and new name are required" });
    }

    sshConn.lastActive = Date.now();

    const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/") + 1);
    const newPath = oldDir + newName;
    fileLogger.info("Renaming item", {
      operation: "file_rename",
      sessionId,
      userId,
      from: oldPath,
      to: newPath,
    });
    try {
      const renamedPath = await renameFileItem(
        await getSessionSftp(sshConn),
        oldPath,
        newName,
      );
      res.json({
        message: "Item renamed successfully",
        oldPath,
        newPath: renamedPath,
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      const message = (error as Error).message;
      res
        .status(
          message === "FILE_TARGET_EXISTS"
            ? 409
            : message === "INVALID_RENAME_PATH"
              ? 400
              : code === 3
                ? 403
                : 500,
        )
        .json({ error: message });
    }
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/moveItem:
   *   put:
   *     summary: Move a file or directory
   *     description: Moves a file or directory on the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               oldPath:
   *                 type: string
   *               newPath:
   *                 type: string
   *     responses:
   *       200:
   *         description: Item moved successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       408:
   *         description: Move operation timed out.
   *       500:
   *         description: Failed to move item.
   */
  app.put("/ssh/file_manager/ssh/moveItem", async (req, res) => {
    const { sessionId, oldPath, newPath } = req.body;
    const sshConn = sshSessions[sessionId];
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

    if (!oldPath || !newPath) {
      return res
        .status(400)
        .json({ error: "Old path and new path are required" });
    }

    sshConn.lastActive = Date.now();

    try {
      const sftp = await getSessionSftp(sshConn);
      const movedPath = await moveFileItem(
        sftp,
        oldPath,
        newPath,
        (source, target) => moveWithNoClobber(sshConn, sftp, source, target),
      );
      res.json({
        message: "Item moved successfully",
        oldPath,
        newPath: movedPath,
      });
    } catch (error) {
      const message = (error as Error).message;
      const code = (error as { code?: number }).code;
      res
        .status(
          message === "FILE_TARGET_EXISTS"
            ? 409
            : message === "INVALID_MOVE_PATH"
              ? 400
              : code === 3
                ? 403
                : 500,
        )
        .json({
          error:
            message === "RENAME_RESULT_UNKNOWN"
              ? "MOVE_RESULT_UNKNOWN"
              : message,
        });
    }
  });
}
