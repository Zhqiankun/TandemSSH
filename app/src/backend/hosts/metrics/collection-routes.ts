import type { Express } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type {
  CollectionSettings,
  MonitoringCollectionRuntime,
} from "./collection-runtime.js";
export function registerMonitoringCollectionRoutes(
  app: Express,
  deps: {
    runtime: MonitoringCollectionRuntime;
    authorize: (hostId: number, userId: string) => Promise<void>;
    settings: (hostId: number, userId: string) => Promise<CollectionSettings>;
    pause: (hostId: number, userId: string) => void;
    resume: (hostId: number, userId: string) => Promise<void>;
  },
): void {
  for (const method of ["get", "post"] as const)
    app[method]("/metrics/collection/:id", async (req, res) => {
      const hostId = Number(req.params.id),
        userId = (req as typeof req & Partial<AuthenticatedRequest>).userId;
      if (!Number.isSafeInteger(hostId) || hostId < 1)
        return res.status(400).json({ code: "MONITORING_IDENTITY_INVALID" });
      if (!userId) return res.status(401).json({ code: "MONITORING_DENIED" });
      try {
        await deps.authorize(hostId, userId);
        const settings = await deps.settings(hostId, userId);
        if (method === "post") {
          const action = req.body?.action;
          if (action !== "pause" && action !== "resume")
            return res.status(400).json({ code: "MONITORING_ACTION_INVALID" });
          if (action === "pause") {
            deps.runtime.pause(hostId, userId);
            deps.pause(hostId, userId);
          } else {
            if (!settings.metricsEnabled)
              return res.status(409).json({ code: "MONITORING_DISABLED" });
            deps.runtime.resume(hostId, userId);
            await deps.resume(hostId, userId);
          }
        }
        return res.json(deps.runtime.snapshot(hostId, userId, settings));
      } catch (error) {
        const code =
          error instanceof Error && /^MONITORING_[A-Z_]+$/.test(error.message)
            ? error.message
            : "MONITORING_UNAVAILABLE";
        return res
          .status(code === "MONITORING_DENIED" ? 403 : 503)
          .json({ code });
      }
    });
}
