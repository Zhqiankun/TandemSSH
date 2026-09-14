import { beforeEach, expect, it, vi } from "vitest";
import type { Request, Response, RequestHandler } from "express";
const access = vi.hoisted(() => ({
  allowed: true,
  host: { enableCommandHistory: true } as {
    enableCommandHistory: boolean;
  } | null,
  lookup: vi.fn(),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => ({ hasAccess: access.allowed }),
    }),
  },
}));
const db = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 1 })),
  listUniqueCommandsForHost: vi.fn(async () => ["pwd"]),
  deleteCommandForHost: vi.fn(async () => 1),
  deleteByUserAndHost: vi.fn(async () => 1),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCommandHistoryRepository: () => db,
  createCurrentSettingsRepository: () => ({ getBoolean: async () => true }),
  createCurrentHostResolutionRepository: () => ({
    findHostHistoryPreference: async (id: number) => {
      access.lookup(id);
      return access.host;
    },
  }),
}));
vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn() },
  databaseLogger: { info: vi.fn() },
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => () => {},
      createDataAccessMiddleware: () => () => {},
    }),
  },
}));
vi.mock("../../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {},
}));
import router from "../../../database/routes/terminal.js";
const routes = [
  ["post", "/command_history"],
  ["get", "/command_history/:hostId"],
  ["post", "/command_history/delete"],
  ["delete", "/command_history/:hostId"],
] as const;
beforeEach(() => {
  vi.clearAllMocks();
  access.allowed = true;
  access.host = { enableCommandHistory: true };
});
async function invoke(method: string, path: string, id: unknown) {
  const layers = (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: RequestHandler }>;
        };
      }>;
    }
  ).stack;
  const handler = layers
    .find((l) => l.route?.path === path && l.route.methods[method])!
    .route!.stack.at(-1)!.handle;
  const result = { status: 200 };
  const res = {
    status(n: number) {
      result.status = n;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  await handler(
    {
      userId: "owner",
      params: { hostId: id },
      body: { hostId: id, command: "pwd" },
    } as unknown as Request,
    res,
    () => {},
  );
  return result;
}
for (const [method, path] of routes) {
  it.each(["1abc", "1.5", "1e3", "-1", "0", "9007199254740993"])(
    method + " " + path + " rejects malformed id %s",
    async (id) => {
      expect((await invoke(method, path, id)).status).toBe(400);
      for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
    },
  );
  it(method + " " + path + " preserves valid owner and host", async () => {
    expect(
      (await invoke(method, path, method === "post" ? 12 : "12")).status,
    ).toBe(method === "post" && path === "/command_history" ? 201 : 200);
    const calls = Object.values(db).flatMap((fn) => fn.mock.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["owner", 12]);
  });
}

it("refuses an inaccessible host before reading its settings or saving history", async () => {
  access.allowed = false;
  expect((await invoke("post", "/command_history", 12)).status).toBe(404);
  expect(access.lookup).not.toHaveBeenCalled();
  expect(db.create).not.toHaveBeenCalled();
});
it("refuses a host removed after permission check", async () => {
  access.host = null;
  expect((await invoke("post", "/command_history", 12)).status).toBe(404);
  expect(db.create).not.toHaveBeenCalled();
});
it("honors an accessible host's history opt-out", async () => {
  access.host = { enableCommandHistory: false };
  expect((await invoke("post", "/command_history", 12)).status).toBe(201);
  expect(db.create).not.toHaveBeenCalled();
});
