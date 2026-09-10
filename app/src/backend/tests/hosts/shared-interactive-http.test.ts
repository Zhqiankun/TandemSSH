import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request } from "node:http";
import { InteractiveAuthService } from "../../hosts/interactive-auth/service.js";
const state = vi.hoisted(() => ({
  userId: "owner",
  apiKeyId: undefined as string | undefined,
  unlocked: true,
  service: undefined as InteractiveAuthService | undefined,
}));
vi.mock("../../hosts/interactive-auth/production.js", () => ({
  interactiveAuth: {
    list: (user: string) => state.service!.list(user),
    respond: (...args: Parameters<InteractiveAuthService["respond"]>) =>
      state.service!.respond(...args),
    cancel: (...args: Parameters<InteractiveAuthService["cancel"]>) =>
      state.service!.cancel(...args),
  },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: () => (state.unlocked ? Buffer.alloc(32) : null),
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
import router from "../../hosts/interactive-auth/http-routes.js";
const app = express();
app.use(express.json());
app.use("/ssh-interactive", router);
const server = createServer(app);
let port: number;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  state.service?.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  state.service?.dispose();
  state.service = new InteractiveAuthService();
  state.userId = "owner";
  state.apiKeyId = undefined;
  state.unlocked = true;
});
function http(method: string, route: string, body?: unknown) {
  return new Promise<{
    status: number;
    headers: Record<string, unknown>;
    body: { requests?: unknown[] };
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/ssh-interactive" + route,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let raw = "";
        res.on("data", (data) => (raw += data));
        res.once("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: JSON.parse(raw),
          }),
        );
      },
    );
    req.once("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function prompt() {
  const finish = vi.fn(),
    abort = vi.fn();
  await state
    .service!.create(
      {
        userId: "owner",
        connectionId: "file",
        channel: "files",
        hostId: 1,
        address: "127.0.0.1",
        port: 22,
        username: "fixture",
      },
      () => {},
      abort,
    )
    .begin("", "", [{ prompt: "Password:", echo: false }], finish);
  const item = (await state.service!.list("owner")).requests[0];
  return { id: item.id, finish, abort };
}
it("requires a human login with unlocked data and never lets an API key answer", async () => {
  const f = await prompt();
  state.apiKeyId = "machine-key";
  expect((await http("GET", "/requests")).status).toBe(403);
  expect(
    (await http("POST", "/respond", { id: f.id, responses: ["secret"] }))
      .status,
  ).toBe(403);
  state.apiKeyId = undefined;
  state.unlocked = false;
  expect((await http("POST", "/cancel", { id: f.id })).status).toBe(403);
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.abort).not.toHaveBeenCalled();
});
it("does not reveal or answer another user's prompt", async () => {
  const f = await prompt();
  state.userId = "other";
  const listing = await http("GET", "/requests");
  expect(listing.body.requests).toEqual([]);
  expect(listing.headers["cache-control"]).toBe("no-store");
  expect(
    (await http("POST", "/respond", { id: f.id, responses: ["wrong"] })).status,
  ).toBe(404);
  expect((await http("POST", "/cancel", { id: f.id })).status).toBe(404);
  expect(f.finish).not.toHaveBeenCalled();
});
it("preserves the answer and refuses duplicate replies after successful consumption", async () => {
  const f = await prompt();
  expect(
    (await http("POST", "/respond", { id: f.id, responses: ["  raw  "] }))
      .status,
  ).toBe(200);
  expect(f.finish).toHaveBeenCalledWith(["  raw  "]);
  expect(
    (await http("POST", "/respond", { id: f.id, responses: ["again"] })).status,
  ).toBe(404);
  expect(f.finish).toHaveBeenCalledOnce();
});
it("rejects malformed replies and lets the owner cancel without sending an empty answer", async () => {
  const f = await prompt();
  expect(
    (await http("POST", "/respond", { id: f.id, responses: [] })).status,
  ).toBe(409);
  expect(
    (
      await http("POST", "/respond", {
        id: f.id,
        responses: ["ok"],
        userId: "owner",
      })
    ).status,
  ).toBe(409);
  expect((await http("POST", "/cancel", { id: f.id })).status).toBe(200);
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.finish).not.toHaveBeenCalled();
});
