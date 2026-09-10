import { Router } from "express";
import { z } from "zod";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { interactiveAuth } from "./production.js";
const router = Router();
router.use(AuthManager.getInstance().createAuthMiddleware());
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const actor = req as AuthenticatedRequest;
  if (
    !actor.userId ||
    actor.apiKeyId ||
    DataCrypto.getUserDataKey(actor.userId) === null
  ) {
    res.status(403).json({ error: "SSH_AUTH_ACCESS_DENIED" });
    return;
  }
  next();
});
const id = z.string().uuid();
const response = z
  .object({ id, responses: z.array(z.string().max(16384)).max(16) })
  .strict();
const cancel = z.object({ id }).strict();
const failure = (res: import("express").Response, error: unknown) => {
  const code =
    error instanceof z.ZodError
      ? "SSH_AUTH_INVALID_RESPONSE"
      : error instanceof Error && /^SSH_AUTH_[A-Z_]+$/.test(error.message)
        ? error.message
        : "SSH_AUTH_CONNECTION_LOST";
  res
    .status(
      code === "SSH_AUTH_ACCESS_DENIED"
        ? 403
        : code === "SSH_AUTH_STALE_PROMPT"
          ? 404
          : 409,
    )
    .json({ error: code });
};
router.get("/requests", async (req, res) => {
  try {
    res.json(await interactiveAuth.list((req as AuthenticatedRequest).userId));
  } catch (e) {
    failure(res, e);
  }
});
router.post("/respond", async (req, res) => {
  try {
    const data = response.parse(req.body);
    await interactiveAuth.respond(
      (req as AuthenticatedRequest).userId,
      data.id,
      data.responses,
    );
    res.json({ ok: true });
  } catch (e) {
    failure(res, e);
  }
});
router.post("/cancel", async (req, res) => {
  try {
    const data = cancel.parse(req.body);
    await interactiveAuth.cancel((req as AuthenticatedRequest).userId, data.id);
    res.json({ ok: true });
  } catch (e) {
    failure(res, e);
  }
});
export default router;
