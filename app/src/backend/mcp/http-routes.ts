import express from "express";
import { z } from "zod";
import { createCurrentHostRepository } from "../database/repositories/factory.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import {
  pairingRegistry,
  startMcpBridge,
  clientConfiguration,
  desktopSessionRequests,
} from "./production.js";
const router = express.Router();
// Mounted below the collaboration router's authenticated human-only gate.
const user = (req: express.Request) => {
  const request = req as AuthenticatedRequest;
  if (!request.userId || request.apiKeyId)
    throw new Error("TRUSTED_UI_REQUIRED");
  return request.userId;
};
function route(
  fn: (req: express.Request) => unknown | Promise<unknown>,
): express.RequestHandler {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((value) => res.json(value))
      .catch((error) => {
        const code =
          error instanceof z.ZodError
            ? "INVALID_REQUEST"
            : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "MCP_REQUEST_FAILED";
        res
          .status(code.endsWith("NOT_FOUND") ? 404 : 400)
          .json({ error: code });
      });
  };
}
router.get(
  "/",
  route(async (req) => {
    const userId = user(req),
      { profileId } = await startMcpBridge();
    return { profileId, running: true, clients: pairingRegistry.list(userId) };
  }),
);
router.get(
  "/hosts",
  route(async (req) => ({
    hosts: (
      await createCurrentHostRepository().listDecryptedByUserId(user(req))
    ).map((host) => ({
      id: host.id,
      name: host.name || host.ip,
      address: host.ip,
      port: host.port || 22,
    })),
  })),
);
router.post(
  "/clients",
  route(async (req) => {
    const userId = user(req);
    await startMcpBridge();
    const input = z
      .object({
        name: z.string().min(1).max(80),
        allowedHostIds: z.array(z.number().int().positive()).min(1).max(1000),
        readTerminal: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const client = await pairingRegistry.create(userId, input);
    return {
      client,
      configuration: await clientConfiguration(userId, client.id),
    };
  }),
);
router.get(
  "/clients/:id/configuration",
  route((req) =>
    clientConfiguration(user(req), z.string().uuid().parse(req.params.id)),
  ),
);
router.delete(
  "/clients/:id",
  route(async (req) => {
    await pairingRegistry.revoke(
      user(req),
      z.string().uuid().parse(req.params.id),
    );
    return { revoked: true };
  }),
);
router.get(
  "/connection-requests",
  route((req) => ({ requests: desktopSessionRequests.list(user(req)) })),
);
router.post(
  "/connection-requests/:id/claim",
  route((req) => {
    const input = z
      .object({ consumerId: z.string().uuid() })
      .strict()
      .parse(req.body);
    return desktopSessionRequests.claim(
      user(req),
      z.string().uuid().parse(req.params.id),
      input.consumerId,
    );
  }),
);
router.post(
  "/connection-requests/:id/fail",
  route((req) => {
    desktopSessionRequests.fail(
      user(req),
      z.string().uuid().parse(req.params.id),
    );
    return { failed: true };
  }),
);
export default router;
