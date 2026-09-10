import type { Express } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { SSHSession } from "./session.js";
import { changeFileOwnership } from "./ownership-service.js";
const identity = z.number().int().min(0).max(4294967294);
const input = z
  .object({
    sessionId: z.string().min(1).max(128),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((p) => p.startsWith("/") && !p.includes("\0")),
    uid: identity,
    gid: identity,
  })
  .strict();
export function registerOwnershipRoute(
  app: Express,
  deps: {
    sshSessions: Record<string, SSHSession>;
    verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
  },
) {
  app.post("/ssh/file_manager/ssh/changeOwnership", async (req, res) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "FILE_OWNERSHIP_INVALID" });
    const { sessionId, path, uid, gid } = parsed.data,
      session = deps.sshSessions[sessionId];
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
    try {
      const result = await changeFileOwnership(session, path, uid, gid);
      if (!res.headersSent && !res.destroyed) res.json(result);
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        res
          .status(500)
          .json({
            error:
              error instanceof Error &&
              error.message === "FILE_OWNERSHIP_UNCONFIRMED"
                ? error.message
                : "FILE_OWNERSHIP_FAILED",
          });
    }
  });
}
