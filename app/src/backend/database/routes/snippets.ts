import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  legacyCommands,
  legacySessionForHost,
  legacyTarget,
} from "../../collaboration/legacy/production.js";
import { getErrorMessage } from "../../utils/error-message.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { extractSnippetReorderUpdates } from "./snippets-reorder.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSnippetRepository,
  createCurrentUserRepository,
  createCurrentSyncTombstoneRepository,
} from "../repositories/factory.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

async function getUserRoleIds(userId: string): Promise<number[]> {
  return createCurrentRoleRepository().listUserRoleIds(userId);
}

async function getActorUsername(userId: string): Promise<string> {
  const user = await createCurrentUserRepository().findById(userId);
  return user?.username ?? userId;
}

function sortSnippets<
  T extends { folder: string | null; order: number; updatedAt: string },
>(a: T, b: T) {
  const aFolder = a.folder || "";
  const bFolder = b.folder || "";

  if (!aFolder && bFolder) return -1;
  if (aFolder && !bFolder) return 1;
  if (aFolder !== bFolder) return aFolder.localeCompare(bFolder);
  if (a.order !== b.order) return a.order - b.order;

  return b.updatedAt.localeCompare(a.updatedAt);
}

async function getAccessibleSnippet(snippetId: number, userId: string) {
  const owned = await createCurrentSnippetRepository().findOwnedById(
    userId,
    snippetId,
  );

  if (owned) {
    return owned;
  }

  const roleIds = await getUserRoleIds(userId);
  return createCurrentRbacAccessRepository().findAccessibleSharedSnippet(
    snippetId,
    userId,
    roleIds,
  );
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * @openapi
 * /snippets/folders:
 *   get:
 *     summary: Get all snippet folders
 *     description: Retrieves all snippet folders for the authenticated user.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: A list of snippet folders.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch snippet folders.
 */
router.get(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet folders fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result = await createCurrentSnippetRepository().listFolders(userId);

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippet folders", err);
      res.status(500).json({ error: "Failed to fetch snippet folders" });
    }
  },
);

/**
 * @openapi
 * /snippets/folders:
 *   post:
 *     summary: Create a new snippet folder
 *     description: Creates a new snippet folder for the authenticated user.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       201:
 *         description: Snippet folder created successfully.
 *       400:
 *         description: Folder name is required.
 *       409:
 *         description: Folder with this name already exists.
 *       500:
 *         description: Failed to create snippet folder.
 */
router.post(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, color, icon } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(name)) {
      authLogger.warn("Invalid snippet folder creation data", {
        operation: "snippet_folder_create",
        userId,
        hasName: !!name,
      });
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const created = await createCurrentSnippetRepository().createFolder(
        userId,
        name,
        color,
        icon,
      );

      if (!created) {
        return res
          .status(409)
          .json({ error: "Folder with this name already exists" });
      }

      authLogger.success(`Snippet folder created: ${name} by user ${userId}`, {
        operation: "snippet_folder_create_success",
        userId,
        name,
      });

      res.status(201).json(created);
    } catch (err) {
      authLogger.error("Failed to create snippet folder", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to create snippet folder"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/{name}/metadata:
 *   put:
 *     summary: Update snippet folder metadata
 *     description: Updates the metadata (color, icon) of a snippet folder.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       200:
 *         description: Snippet folder metadata updated successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Folder not found.
 *       500:
 *         description: Failed to update snippet folder metadata.
 */
router.put(
  "/folders/:name/metadata",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const name = Array.isArray(req.params.name)
      ? req.params.name[0]
      : req.params.name;
    const { color, icon } = req.body;

    if (!isNonEmptyString(userId) || !name) {
      authLogger.warn("Invalid request for snippet folder metadata update");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const decodedName = decodeURIComponent(name);
      const updated =
        await createCurrentSnippetRepository().updateFolderMetadata(
          userId,
          decodedName,
          color,
          icon,
        );

      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }

      authLogger.success(
        `Snippet folder metadata updated: ${name} by user ${userId}`,
        {
          operation: "snippet_folder_metadata_update_success",
          userId,
          name,
        },
      );

      res.json(updated);
    } catch (err) {
      authLogger.error("Failed to update snippet folder metadata", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to update snippet folder metadata"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/rename:
 *   put:
 *     summary: Rename a snippet folder
 *     description: Renames a snippet folder for the authenticated user.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldName:
 *                 type: string
 *               newName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder renamed successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Folder not found.
 *       409:
 *         description: Folder with new name already exists.
 *       500:
 *         description: Failed to rename snippet folder.
 */
router.put(
  "/folders/rename",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { oldName, newName } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(oldName) ||
      !isNonEmptyString(newName)
    ) {
      authLogger.warn("Invalid request for snippet folder rename");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const result = await createCurrentSnippetRepository().renameFolder(
        userId,
        oldName,
        newName,
      );

      if (result.status === "missing") {
        return res.status(404).json({ error: "Folder not found" });
      }

      if (result.status === "conflict") {
        return res
          .status(409)
          .json({ error: "Folder with new name already exists" });
      }

      authLogger.success(
        `Snippet folder renamed: ${oldName} -> ${newName} by user ${userId}`,
        {
          operation: "snippet_folder_rename_success",
          userId,
          oldName,
          newName,
        },
      );

      res.json({ success: true, oldName, newName });
    } catch (err) {
      authLogger.error("Failed to rename snippet folder", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to rename snippet folder"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/{name}:
 *   delete:
 *     summary: Delete a snippet folder
 *     description: Deletes a snippet folder and moves its snippets to the root.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Snippet folder deleted successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to delete snippet folder.
 */
router.delete(
  "/folders/:name",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const name = Array.isArray(req.params.name)
      ? req.params.name[0]
      : req.params.name;

    if (!isNonEmptyString(userId) || !name) {
      authLogger.warn("Invalid request for snippet folder delete");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const folderName = decodeURIComponent(name);

      const deletedFolder = await createCurrentSnippetRepository().deleteFolder(
        userId,
        folderName,
      );
      if (deletedFolder?.syncId) {
        await createCurrentSyncTombstoneRepository().record(
          userId,
          "snippetFolders",
          deletedFolder.syncId,
        );
      }

      authLogger.success(
        `Snippet folder deleted: ${folderName} by user ${userId}`,
        {
          operation: "snippet_folder_delete_success",
          userId,
          name: folderName,
        },
      );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet folder", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to delete snippet folder"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/reorder:
 *   put:
 *     summary: Reorder snippets
 *     description: Bulk updates the order and folder of snippets. Accepts
 *       `snippets` and the legacy `updates` payload key.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snippets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     order:
 *                       type: integer
 *                     folder:
 *                       type: string
 *     responses:
 *       200:
 *         description: Snippets reordered successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to reorder snippets.
 */
router.put(
  "/reorder",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const snippetUpdates = extractSnippetReorderUpdates(req.body);

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet reorder");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!snippetUpdates || snippetUpdates.length === 0) {
      authLogger.warn("Invalid snippet reorder data", {
        operation: "snippet_reorder",
        userId,
      });
      return res
        .status(400)
        .json({ error: "snippets array is required and must not be empty" });
    }

    try {
      await createCurrentSnippetRepository().reorderSnippets(
        userId,
        snippetUpdates,
      );

      authLogger.success(`Snippets reordered by user ${userId}`, {
        operation: "snippet_reorder_success",
        userId,
        count: snippetUpdates.length,
      });

      res.json({ success: true, updated: snippetUpdates.length });
    } catch (err) {
      authLogger.error("Failed to reorder snippets", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to reorder snippets"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/execute:
 *   post:
 *     summary: Create a snippet task awaiting human authorization
 *     description: Uses an existing owned SSH terminal. No command is executed by this request. If sessionId is absent, exactly one connected owned session must match the host. API keys cannot use this human entry.
 *     tags: [Snippets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [snippetId, hostId]
 *             properties:
 *               snippetId:
 *                 type: integer
 *               hostId:
 *                 type: integer
 *               sessionId:
 *                 type: string
 *                 format: uuid
 *               requestId:
 *                 type: string
 *                 maxLength: 128
 *               mode:
 *                 type: string
 *                 enum: [collaborative, automatic]
 *                 default: collaborative
 *               inputValues:
 *                 type: object
 *                 description: INPUT_n values inserted as argument data after parsing. Host variables are resolved from the owned host on the server.
 *                 additionalProperties:
 *                   type: string
 *     responses:
 *       202:
 *         description: Task created with status awaiting-authorization, taskId and sessionId. The legacy success field is false because execution has not occurred.
 *       400:
 *         description: Invalid request, or the selected snippet is a note.
 *       403:
 *         description: Trusted human identity required.
 *       404:
 *         description: Snippet not found or inaccessible.
 *       409:
 *         description: Session, host scope or command migration conflict. No command was sent.
 */
router.post(
  "/execute",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const user = req as AuthenticatedRequest;
    if (!user.userId || user.apiKeyId)
      return res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
    try {
      const p = z
        .object({
          snippetId: z.coerce.number().int().positive(),
          hostId: z.coerce.number().int().positive(),
          sessionId: z.string().uuid().optional(),
          mode: z.enum(["automatic", "collaborative"]).optional(),
          requestId: z.string().min(1).max(128).optional(),
          inputValues: z.record(z.string(), z.string().max(32768)).optional(),
        })
        .strict()
        .parse(req.body);
      const snippet = await getAccessibleSnippet(p.snippetId, user.userId);
      if (!snippet) return res.status(404).json({ error: "SNIPPET_NOT_FOUND" });
      if (snippet.isNote)
        return res.status(400).json({ error: "NOTE_NOT_EXECUTABLE" });
      const sessionId =
        p.sessionId ?? legacySessionForHost(user.userId, p.hostId);
      const target = await legacyTarget(user.userId, sessionId);
      if (target.hostId !== p.hostId)
        return res.status(409).json({ error: "HOST_SCOPE_CHANGED" });
      const { task } = await legacyCommands.create(user.userId, {
        sessionId,
        requestId: p.requestId ?? randomUUID(),
        mode: p.mode,
        source: {
          kind: "snippet",
          title: snippet.name,
          content: snippet.content,
          inputs: p.inputValues,
        },
      });
      return res.status(202).json({
        status: "awaiting-authorization",
        taskId: task.id,
        sessionId,
        hostId: p.hostId,
        success: false,
        output: "已创建待授权任务，请在该主机的 SSH 协作面板审阅并授权。",
      });
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? "INVALID_REQUEST"
          : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "TASK_REQUEST_FAILED";
      return res
        .status(error instanceof z.ZodError ? 400 : 409)
        .json({ error: code });
    }
  },
);

/**
 * @openapi
 * /snippets/export:
 *   get:
 *     summary: Export all snippets and folders as JSON
 *     description: Returns all snippets and snippet folders for the authenticated user as a JSON export.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: Export object containing snippets and folders arrays.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to export snippets.
 */
router.get(
  "/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet export");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const snippetRepository = createCurrentSnippetRepository();
      const allSnippets = await snippetRepository.listSnippetsForExport(userId);
      const allFolders = await snippetRepository.listFoldersForExport(userId);

      const exportedSnippets = allSnippets.map((s) => ({
        name: s.name,
        content: s.content,
        description: s.description,
        folder: s.folder,
        order: s.order,
        hostFilter: s.hostFilter,
      }));

      const exportedFolders = allFolders.map((f) => ({
        name: f.name,
        color: f.color,
        icon: f.icon,
      }));

      authLogger.success(`Snippets exported by user ${userId}`, {
        operation: "snippet_export",
        userId,
        snippetCount: exportedSnippets.length,
        folderCount: exportedFolders.length,
      });

      res.json({ snippets: exportedSnippets, folders: exportedFolders });
    } catch (err) {
      authLogger.error("Failed to export snippets", err);
      res.status(500).json({ error: "Failed to export snippets" });
    }
  },
);

/**
 * @openapi
 * /snippets/bulk-import:
 *   post:
 *     summary: Bulk import snippets and folders from JSON
 *     description: Imports snippets and folders. Existing folders are skipped; existing snippets (matched by name+folder) can be skipped or overwritten.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snippets:
 *                 type: array
 *               folders:
 *                 type: array
 *               overwrite:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Import results with counts.
 *       400:
 *         description: Invalid request body.
 *       500:
 *         description: Failed to import snippets.
 */
router.post(
  "/bulk-import",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const {
      snippets: snippetsToImport,
      folders: foldersToImport,
      overwrite,
    } = req.body;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!Array.isArray(snippetsToImport) && !Array.isArray(foldersToImport)) {
      return res
        .status(400)
        .json({ error: "snippets or folders array is required" });
    }

    try {
      const results = await createCurrentSnippetRepository().bulkImport(
        userId,
        snippetsToImport,
        foldersToImport,
        !!overwrite,
      );

      authLogger.success(`Snippets bulk-imported by user ${userId}`, {
        operation: "snippet_bulk_import",
        userId,
        ...results,
      });

      res.json({ success: true, ...results });
    } catch (err) {
      authLogger.error("Failed to bulk import snippets", err);
      res.status(500).json({ error: "Failed to import snippets" });
    }
  },
);

/**
 * @openapi
 * /snippets:
 *   get:
 *     summary: Get all snippets
 *     description: Retrieves all snippets for the authenticated user.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: A list of snippets.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch snippets.
 */
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippets fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const ownedSnippets =
        await createCurrentSnippetRepository().listOwnedSnippets(userId);

      const roleIds = await getUserRoleIds(userId);
      const sharedSnippets =
        await createCurrentRbacAccessRepository().listVisibleSharedSnippets(
          userId,
          roleIds,
        );

      const visibleSnippets = new Map<number, Record<string, unknown>>();
      for (const snippet of ownedSnippets) {
        visibleSnippets.set(snippet.id, { ...snippet, isShared: false });
      }
      for (const snippet of sharedSnippets) {
        if (visibleSnippets.has(snippet.id)) continue;
        visibleSnippets.set(snippet.id, { ...snippet, isShared: true });
      }

      const result = Array.from(visibleSnippets.values()).sort((a, b) =>
        sortSnippets(
          a as { folder: string | null; order: number; updatedAt: string },
          b as { folder: string | null; order: number; updatedAt: string },
        ),
      );

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippets", err);
      res.status(500).json({ error: "Failed to fetch snippets" });
    }
  },
);

/**
 * @openapi
 * /snippets/{id}:
 *   get:
 *     summary: Get a specific snippet
 *     description: Retrieves a specific snippet by its ID.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The requested snippet.
 *       400:
 *         description: Invalid request parameters.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to fetch snippet.
 */
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const snippetId = parseInt(id, 10);

    if (!isNonEmptyString(userId) || isNaN(snippetId)) {
      authLogger.warn("Invalid request for snippet fetch: invalid ID", {
        userId,
        id,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      const result = await getAccessibleSnippet(snippetId, userId);

      if (!result) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippet", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to fetch snippet"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets:
 *   post:
 *     summary: Create a new snippet
 *     description: Creates a new snippet for the authenticated user.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *               description:
 *                 type: string
 *               folder:
 *                 type: string
 *               order:
 *                 type: integer
 *               isNote:
 *                 type: boolean
 *                 description: When true, the snippet is a note (copy/paste only, not directly executable on a host).
 *     responses:
 *       201:
 *         description: Snippet created successfully.
 *       400:
 *         description: Name and content are required.
 *       500:
 *         description: Failed to create snippet.
 */
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, content, description, folder, order, hostFilter, isNote } =
      req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(name) ||
      !isNonEmptyString(content)
    ) {
      authLogger.warn("Invalid snippet creation data validation failed", {
        operation: "snippet_create",
        userId,
        hasName: !!name,
        hasContent: !!content,
      });
      return res.status(400).json({ error: "Name and content are required" });
    }

    try {
      const result = await createCurrentSnippetRepository().createSnippet(
        userId,
        {
          name,
          content,
          description,
          folder,
          order,
          hostFilter,
          isNote,
        },
      );
      databaseLogger.info("Command snippet created", {
        operation: "snippet_create",
        userId,
        snippetId: result.id,
        name,
      });

      const { ipAddress: scIp, userAgent: scUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "create_snippet",
        resourceType: "snippet",
        resourceId: String(result.id),
        resourceName: name,
        ipAddress: scIp,
        userAgent: scUa,
        success: true,
      });

      res.status(201).json(result);
    } catch (err) {
      authLogger.error("Failed to create snippet", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to create snippet"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/{id}:
 *   put:
 *     summary: Update a snippet
 *     description: Updates a specific snippet by its ID.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *               description:
 *                 type: string
 *               folder:
 *                 type: string
 *               order:
 *                 type: integer
 *               isNote:
 *                 type: boolean
 *                 description: When true, the snippet is a note (copy/paste only, not directly executable on a host).
 *     responses:
 *       200:
 *         description: The updated snippet.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to update snippet.
 */
router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet update");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const snippetId = parseInt(id);
      const result = await createCurrentSnippetRepository().updateSnippet(
        userId,
        snippetId,
        updateData,
      );

      if (!result) {
        return res.status(404).json({ error: "Snippet not found" });
      }
      databaseLogger.info("Command snippet updated", {
        operation: "snippet_update",
        userId,
        snippetId,
      });

      const { ipAddress: suIp, userAgent: suUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "update_snippet",
        resourceType: "snippet",
        resourceId: id,
        resourceName: result.existing.name,
        ipAddress: suIp,
        userAgent: suUa,
        success: true,
      });

      res.json(result.updated);
    } catch (err) {
      authLogger.error("Failed to update snippet", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to update snippet"),
      });
    }
  },
);

/**
 * @openapi
 * /snippets/{id}:
 *   delete:
 *     summary: Delete a snippet
 *     description: Deletes a specific snippet by its ID.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Snippet deleted successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to delete snippet.
 */
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet delete");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const snippetId = parseInt(id);
      const existing = await createCurrentSnippetRepository().deleteSnippet(
        userId,
        snippetId,
      );

      if (!existing) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      if (existing.syncId) {
        await createCurrentSyncTombstoneRepository().record(
          userId,
          "snippets",
          existing.syncId,
        );
      }

      databaseLogger.info("Command snippet deleted", {
        operation: "snippet_delete",
        userId,
        snippetId,
      });

      const { ipAddress: sdIp, userAgent: sdUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "delete_snippet",
        resourceType: "snippet",
        resourceId: id,
        resourceName: existing.name,
        ipAddress: sdIp,
        userAgent: sdUa,
        success: true,
      });

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to delete snippet"),
      });
    }
  },
);

export default router;
