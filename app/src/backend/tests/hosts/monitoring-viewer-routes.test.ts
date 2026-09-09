import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { registerHostMetricsViewerRoutes } from "../../hosts/metrics/viewer-routes";
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.alloc(32) },
}));
vi.mock("../../utils/logger.js", () => ({
  statsLogger: { warn: vi.fn(), error: vi.fn() },
}));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("passes the authenticated owner to heartbeat and unregister and refuses another user's viewer", async () => {
  const rows = new Map([
    ["viewer-a", { hostId: 7, userId: "alice" }],
    ["viewer-b", { hostId: 7, userId: "bob" }],
  ]);
  const heartbeat = vi.fn(
      (id: string, user: string) => rows.get(id)?.userId === user,
    ),
    unregister = vi.fn((host: number, id: string, user: string) => {
      const row = rows.get(id);
      if (row?.hostId !== host || row.userId !== user) return false;
      rows.delete(id);
      return true;
    });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: req.headers["x-fixture-user"] });
    next();
  });
  registerHostMetricsViewerRoutes(app, {
    fetchHostById: async () => ({ statsConfig: { metricsEnabled: true } }),
    supportsMetrics: () => true,
    parseStatsConfig: (raw) => raw!,
    registerViewer: vi.fn(),
    updateHeartbeat: heartbeat,
    unregisterViewer: unregister,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/metrics/";
  const post = (route: string, id: string, user: string, host = 7) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-fixture-user": user },
      body: JSON.stringify({ viewerSessionId: id, hostId: host }),
    });
  expect((await post("heartbeat", "viewer-a", "bob")).status).toBe(404);
  expect(heartbeat).toHaveBeenLastCalledWith("viewer-a", "bob");
  expect((await post("unregister-viewer", "viewer-a", "bob")).status).toBe(403);
  expect((await post("unregister-viewer", "viewer-a", "alice", 8)).status).toBe(
    403,
  );
  expect((await post("unregister-viewer", "viewer-a", "alice")).status).toBe(
    200,
  );
  expect(rows.has("viewer-b")).toBe(true);
  expect((await post("heartbeat", "viewer-b", "bob")).status).toBe(200);
});
