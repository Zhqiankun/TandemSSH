import { Router } from "express";
import { z } from "zod";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { hostTrust } from "./production.js";
const router = Router();
router.use(AuthManager.getInstance().createAuthMiddleware());
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const actor = req as AuthenticatedRequest;
  if (!actor.userId || actor.apiKeyId) {
    res.status(403).json({ error: "TRUSTED_UI_REQUIRED" });
    return;
  }
  next();
});
export const hostTrustDecisionSchema = z
  .object({
    requestId: z.string().uuid(),
    fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(["trust", "reject"]),
    verified: z.boolean(),
  })
  .strict();
router.get("/requests", (req, res) =>
  res.json(hostTrust.list((req as AuthenticatedRequest).userId)),
);
router.post("/decide", async (req, res) => {
  try {
    const result = await hostTrust.decide(
      (req as AuthenticatedRequest).userId,
      hostTrustDecisionSchema.parse(req.body),
    );
    res.json(result);
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "INVALID_REQUEST"
        : error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message
          : "HOST_TRUST_STORAGE_UNAVAILABLE";
    res
      .status(code === "HOST_TRUST_REQUEST_NOT_FOUND" ? 404 : 409)
      .json({ error: code });
  }
});
export default router;
