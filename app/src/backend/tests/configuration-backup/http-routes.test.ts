import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { ConfigurationBackupService } from "../../configuration-backup/service.js";
import { configurationBackupRoutes } from "../../configuration-backup/http-routes.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  const apply = vi.fn(async (_user: string, r: { id: string }) => ({
    receiptId: r.id,
    hostIds: [1],
    workflowIds: [],
    preferencesRestored: false,
  }));
  const service = new ConfigurationBackupService({
    snapshot: async () => ({
      fingerprint: "fixture",
      hosts: [],
      workflows: [],
    }),
    apply,
    audit: async () => {},
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/configuration-backup",
    configurationBackupRoutes(service, (req, _res, next) => {
      Object.assign(req, {
        userId: req.headers["x-fixture-user"],
        apiKeyId: req.headers["x-fixture-api-key"],
      });
      next();
    }),
  );
  const server = createServer(app);
  // Keep fixture allocation above Fetch's blocked service-port range.
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          server.off("error", failed);
          resolve();
        };
        const failed = (error: Error) => {
          server.off("listening", ready);
          reject(error);
        };
        server.once("listening", ready);
        server.once("error", failed);
        server.listen(randomInt(20000, 60000), "127.0.0.1");
      });
      break;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
        attempt >= 19
      )
        throw error;
    }
  }
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/configuration-backup";
  const call = (path: string, body?: unknown, user = "owner", key?: string) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type":
          typeof body === "string"
            ? "application/vnd.tandemssh.backup+json"
            : "application/json",
        "x-fixture-user": user,
        ...(key ? { "x-fixture-api-key": key } : {}),
      },
      body:
        typeof body === "string"
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
  return { call, apply };
}
const file = () =>
  JSON.stringify({
    format: "tandemssh-configuration",
    version: 1,
    createdAt: new Date().toISOString(),
    hosts: [],
    workflows: [],
  });
it("requires an authenticated UI user and never applies during preview", async () => {
  const f = await fixture();
  expect((await f.call("/export/preview", {}, "")).status).toBe(403);
  expect(
    (await f.call("/export/preview", {}, "owner", "fixture-key")).status,
  ).toBe(403);
  const r = await f.call("/import/preview", file());
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(f.apply).not.toHaveBeenCalled();
});
it("requires explicit confirmation and rejects another users preview", async () => {
  const f = await fixture(),
    p = await (await f.call("/import/preview", file())).json();
  expect(
    (
      await f.call("/import/" + p.id, {
        confirmed: false,
        restorePreferences: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.call(
        "/import/" + p.id,
        { confirmed: true, restorePreferences: false },
        "other",
      )
    ).status,
  ).toBe(404);
  expect(f.apply).not.toHaveBeenCalled();
  expect(
    (
      await f.call("/import/" + p.id, {
        confirmed: true,
        restorePreferences: false,
      })
    ).status,
  ).toBe(200);
  expect(f.apply).toHaveBeenCalledTimes(1);
});
it("returns the exact preview content for download", async () => {
  const f = await fixture(),
    p = await (await f.call("/export/preview", {})).json(),
    r = await f.call("/export/" + p.id);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe(p.content);
  expect(r.headers.get("content-disposition")).toContain("attachment");
});
it("returns a structured 413 when the upload exceeds the format limit", async () => {
  const f = await fixture(),
    r = await f.call("/import/preview", " ".repeat(8 * 1024 * 1024 + 1));
  expect(r.status).toBe(413);
  expect(await r.json()).toEqual({ code: "BACKUP_TOO_LARGE" });
  expect(f.apply).not.toHaveBeenCalled();
});
