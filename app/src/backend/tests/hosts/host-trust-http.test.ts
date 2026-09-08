import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { HostTrustService } from "../../hosts/trust/service";
import type { HostTrustRecord } from "../../../types/host-trust";
const state = vi.hoisted(() => ({
  userId: "owner",
  apiKeyId: undefined as string | undefined,
  service: undefined as HostTrustService | undefined,
}));
vi.mock("../../hosts/trust/production.js", () => ({
  hostTrust: {
    list: (userId: string) => state.service!.list(userId),
    decide: (...args: Parameters<HostTrustService["decide"]>) =>
      state.service!.decide(...args),
  },
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: express.Request, _res: express.Response, next: () => void) => {
          Object.assign(req, {
            userId: state.userId,
            apiKeyId: state.apiKeyId,
          });
          next();
        },
    }),
  },
}));
import router from "../../hosts/trust/http-routes";
const app = express();
app.use(express.json());
app.use("/host-trust", router);
const server = createServer(app);
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base =
    "http://127.0.0.1:" +
    (server.address() as { port: number }).port +
    "/host-trust";
});
afterAll(async () => {
  state.service?.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  state.service?.dispose();
  state.userId = "owner";
  state.apiKeyId = undefined;
  const rows = new Map<string, HostTrustRecord>();
  state.service = new HostTrustService({
    store: {
      get: async (id, userId) => {
        const r = rows.get(id);
        return r?.userId === userId ? r : undefined;
      },
      compareAndSet: async (r) => {
        rows.set(r.id, r);
      },
    },
    audit: async () => {},
  });
});
const post = (body: unknown) =>
  fetch(base + "/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("keeps pending trust requests and decisions behind a human user boundary", async () => {
  const type = Buffer.from("ssh-ed25519"),
    size = Buffer.alloc(4);
  size.writeUInt32BE(type.length);
  const waiting = state.service!.verify(
    { userId: "owner", address: "fixture", port: 22, isJumpHost: false },
    Buffer.concat([size, type, Buffer.alloc(32)]),
  );
  await vi.waitFor(() =>
    expect(state.service!.list("owner").requests).toHaveLength(1),
  );
  const p = state.service!.list("owner").requests[0];
  const decision = {
    requestId: p.id,
    fingerprint: p.fingerprint,
    expectedRevision: 0,
    action: "trust",
    verified: true,
  };
  state.apiKeyId = "key";
  expect((await fetch(base + "/requests")).status).toBe(403);
  expect((await post(decision)).status).toBe(403);
  state.apiKeyId = undefined;
  state.userId = "other";
  expect(await (await fetch(base + "/requests")).json()).toMatchObject({
    requests: [],
  });
  expect((await post(decision)).status).toBe(404);
  state.userId = "owner";
  const list = await fetch(base + "/requests");
  expect(list.headers.get("cache-control")).toBe("no-store");
  expect((await post({ ...decision, userId: "other" })).status).toBe(409);
  expect((await post({ ...decision, verified: false })).status).toBe(409);
  expect((await post({ ...decision, requestId: randomUUID() })).status).toBe(
    404,
  );
  expect((await post(decision)).status).toBe(200);
  expect(await waiting).toBe(true);
});
