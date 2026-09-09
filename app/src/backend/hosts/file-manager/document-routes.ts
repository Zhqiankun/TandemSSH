import type { Express, Request, Response } from "express";
import { fileDrafts } from "../../files/drafts/production.js";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { documents, bindFileBrowserDocuments } from "../../files/production.js";
import { DocumentError } from "../../files/errors.js";
import type { SSHSession } from "./session.js";
const charset = z.enum(["utf8", "utf16le", "utf16be", "gbk", "gb18030"]);
const format = z
  .object({
    charset,
    bom: z.boolean(),
    lineEnding: z.enum(["lf", "crlf", "cr", "mixed", "none"]),
  })
  .strict();
const filePath = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine((path) => !path.includes("\0"));
const save = z
  .object({
    sessionId: z.string().min(1).max(256),
    path: filePath,
    content: z.string().max(32 * 1024 * 1024),
    version: z.string().uuid(),
    requestId: z.string().min(1).max(128),
    format: format.optional(),
    takeover: z.boolean().optional(),
    saveAs: filePath.optional(),
  })
  .strict();
function errorResponse(error: unknown, res: Response) {
  const code =
    error instanceof z.ZodError
      ? "FILE_REQUEST_INVALID"
      : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "FILE_IO_FAILED";
  const details = error instanceof DocumentError ? error.details : {};
  res
    .status(
      code === "FILE_NOT_FOUND"
        ? 404
        : code === "FILE_CONFLICT" ||
            code === "FILE_TARGET_CHANGED" ||
            code === "FILE_CONNECTION_CHANGED"
          ? 409
          : code === "FILE_AUTOMATION_ACTIVE" || code === "FILE_BUSY"
            ? 423
            : 400,
    )
    .json({
      error: code,
      ...details,
      tooLarge: code === "FILE_TOO_LARGE",
      fileNotFound: code === "FILE_NOT_FOUND",
    });
}
export function registerDocumentRoutes(
  app: Express,
  sessions: Record<string, SSHSession>,
) {
  bindFileBrowserDocuments((id) => sessions[id]);
  function route(
    action: (
      userId: string,
      req: Request,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {
    return (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const user = req as AuthenticatedRequest;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const close = () => {
        if (!res.writableEnded) abort();
      };
      req.once("aborted", abort);
      res.once("close", close);
      let session: SSHSession | undefined;
      let held = false;
      Promise.resolve()
        .then(() => {
          if (!user.userId || user.apiKeyId)
            throw new DocumentError("TRUSTED_UI_REQUIRED");
          const id =
            typeof req.body?.sessionId === "string"
              ? req.body.sessionId
              : req.query.sessionId;
          session = typeof id === "string" ? sessions[id] : undefined;
          if (session) {
            if (session.userId !== user.userId)
              throw new DocumentError("FILE_SESSION_UNAVAILABLE");
            session.activeOperations++;
            held = true;
          }
          return action(user.userId, req, controller.signal);
        })
        .then((value) => {
          if (!res.destroyed) res.json(value);
        })
        .catch((error) => {
          if (!res.destroyed) errorResponse(error, res);
        })
        .finally(() => {
          req.removeListener("aborted", abort);
          res.removeListener("close", close);
          if (session && held)
            session.activeOperations = Math.max(
              0,
              session.activeOperations - 1,
            );
        });
    };
  }
  app.get(
    "/ssh/file_manager/ssh/readFile",
    route(async (userId, req, signal) => {
      const p = z
        .object({
          sessionId: z.string().min(1).max(256),
          path: filePath,
          charset: charset.optional(),
          editor: z.enum(["true", "false"]).optional(),
        })
        .strict()
        .parse(req.query);
      return documents.read(
        { userId, source: "human", signal },
        p.sessionId,
        p.path,
        p.charset,
        p.editor === "true",
      );
    }),
  );
  app.post(
    "/ssh/file_manager/ssh/writeFile",
    route(async (userId, req, signal) => {
      const p = save.parse(req.body);
      return documents.save({ userId, source: "human", signal }, p);
    }),
  );
  const draftReference = z.object({
    sessionId: z.string().min(1).max(256),
    version: z.string().uuid(),
  });
  app.post(
    "/ssh/file_manager/ssh/draft/read",
    route(async (userId, req) => {
      const p = draftReference.strict().parse(req.body),
        context = await documents.draftContext(
          { userId, source: "human" },
          p.sessionId,
          p.version,
        );
      return { draft: await fileDrafts.read(context.binding) };
    }),
  );
  app.post(
    "/ssh/file_manager/ssh/draft/write",
    route(async (userId, req) => {
      const p = draftReference
        .extend({
          expectedRevision: z.string().uuid().nullable(),
          original: z.string().max(8 * 1024 * 1024),
          content: z.string().max(8 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      const context = await documents.draftContext(
        { userId, source: "human" },
        p.sessionId,
        p.version,
        p.original,
      );
      return {
        draft: await fileDrafts.write(
          context.binding,
          { original: p.original, content: p.content, format: context.format },
          p.expectedRevision,
        ),
      };
    }),
  );
  app.post(
    "/ssh/file_manager/ssh/draft/remove",
    route(async (userId, req) => {
      const p = draftReference
          .extend({ expectedRevision: z.string().uuid() })
          .strict()
          .parse(req.body),
        context = await documents.draftContext(
          { userId, source: "human" },
          p.sessionId,
          p.version,
        );
      await fileDrafts.remove(context.binding, p.expectedRevision);
      return { removed: true };
    }),
  );
  app.post(
    "/ssh/file_manager/ssh/closeDocument",
    route(async (userId, req, signal) => {
      const p = z
        .object({ documentId: z.string().uuid() })
        .strict()
        .parse(req.body);
      documents.close({ userId, source: "human", signal }, p.documentId);
      return { closed: true };
    }),
  );
}
