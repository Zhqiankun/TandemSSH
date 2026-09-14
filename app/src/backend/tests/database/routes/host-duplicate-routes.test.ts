import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
const duplicate = vi.hoisted(() => vi.fn());
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({ duplicateOwnedForUser: duplicate }),
}));
import { registerHostDuplicateRoutes } from "../../../database/routes/host-duplicate-routes.js";
let server: Server | undefined;
afterEach(async () => {
  vi.resetAllMocks();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
});
it("accepts only an owned-host ID and name, returns no secrets, and rejects untrusted requests", async () => {
  const app = express();
  app.use(express.json());
  let userId: string | undefined = "owner",
    apiKeyId: string | undefined;
  registerHostDuplicateRoutes(
    app,
    (req, _res, next) => {
      Object.assign(req, { userId, apiKeyId });
      next();
    },
    (_req, _res, next) => next(),
  );
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const post = (id: string, body: unknown) =>
    fetch(base + "/db/host/" + id + "/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  duplicate.mockResolvedValue({ id: 9, key: "fixture-private-key" });
  const ok = await post("1", { name: "中文副本" });
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ id: 9 });
  expect(duplicate).toHaveBeenCalledWith("owner", 1, "中文副本");
  for (const [id, body] of [
    ["0", { name: "copy" }],
    ["nope", { name: "copy" }],
    ["1", { name: "" }],
    ["1", { name: "copy", userId: "other" }],
    ["1", { name: "copy", key: "injected" }],
  ] as const) {
    expect((await post(id, body)).status).toBe(400);
  }
  expect(duplicate).toHaveBeenCalledTimes(1);
  apiKeyId = "api-key";
  expect((await post("1", { name: "copy" })).status).toBe(403);
  apiKeyId = undefined;
  userId = undefined;
  expect((await post("1", { name: "copy" })).status).toBe(403);
  expect(duplicate).toHaveBeenCalledTimes(1);
  userId = "owner";
  duplicate.mockResolvedValueOnce(null);
  expect((await post("2", { name: "copy" })).status).toBe(404);
  duplicate.mockRejectedValueOnce(Error("fixture-private-key must not leak"));
  const failure = await post("1", { name: "copy" });
  expect(failure.status).toBe(500);
  expect(await failure.json()).toEqual({ error: "HOST_DUPLICATE_FAILED" });
});
