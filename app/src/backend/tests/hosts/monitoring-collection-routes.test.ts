import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { MonitoringCollectionRuntime } from "../../hosts/metrics/collection-runtime";
import { registerMonitoringCollectionRoutes } from "../../hosts/metrics/collection-routes";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("protects sampling records and controls by current host permission", async () => {
  const settings = {
    metricsEnabled: true,
    metricsInterval: 30,
    enabledWidgets: ["memory"],
  };
  const authorize = vi.fn(async (host: number, user: string) => {
    if (host !== 7 || user !== "reader") throw Error("MONITORING_DENIED");
  });
  const runtime = new MonitoringCollectionRuntime({
    authorize,
    audit: async () => {},
  });
  const pause = vi.fn(),
    resume = vi.fn(async () => {});
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: req.headers["x-fixture-user"] });
    next();
  });
  registerMonitoringCollectionRoutes(app, {
    runtime,
    authorize,
    settings: async () => settings,
    pause,
    resume,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/metrics/collection/";
  const call = (host: number, user?: string, action?: string) =>
    fetch(base + host, {
      method: action ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(user ? { "x-fixture-user": user } : {}),
      },
      body: action ? JSON.stringify({ action }) : undefined,
    });
  expect((await call(7)).status).toBe(401);
  expect((await call(7, "someone-else")).status).toBe(403);
  expect((await call(8, "reader", "pause")).status).toBe(403);
  expect(pause).not.toHaveBeenCalled();
  const initial = await (await call(7, "reader")).json();
  expect(initial.commands.map((c: { template: string }) => c.template)).toEqual(
    ["cat /proc/meminfo"],
  );
  expect((await call(7, "reader", "run-command")).status).toBe(400);
  const stopped = await (await call(7, "reader", "pause")).json();
  expect(stopped.paused).toBe(true);
  expect(pause).toHaveBeenCalledWith(7, "reader");
  expect(runtime.isPaused(7, "someone-else")).toBe(false);
  expect((await (await call(7, "reader", "resume")).json()).paused).toBe(false);
  expect(resume).toHaveBeenCalledWith(7, "reader");
  settings.metricsEnabled = false;
  expect((await call(7, "reader", "resume")).status).toBe(409);
});
