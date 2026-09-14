import { beforeEach, expect, it, vi } from "vitest";
import type { Request, Response, RequestHandler, Router } from "express";
const db = vi.hoisted(() => ({
  listCommandsForHost: vi.fn(async () => ["pwd"]),
  deleteCommandForHost: vi.fn(async () => 1),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCommandHistoryRepository: () => db,
}));
vi.mock("../../../utils/logger.js", () => ({
  sshLogger: { warn: vi.fn(), error: vi.fn() },
}));
import { registerHostCommandHistoryRoutes } from "../../../database/routes/host-command-history-routes.js";
const handlers = new Map<string, RequestHandler>();
registerHostCommandHistoryRoutes(
  {
    get: (_path: string, ...h: RequestHandler[]) =>
      handlers.set("get", h.at(-1)!),
    delete: (_path: string, ...h: RequestHandler[]) =>
      handlers.set("delete", h.at(-1)!),
  } as unknown as Router,
  (_q, _s, next) => next(),
);
beforeEach(() => vi.clearAllMocks());
async function invoke(
  method: string,
  hostId: unknown,
  command: unknown = "pwd",
) {
  const result = { status: 200, body: undefined as unknown };
  const res = {
    status(n: number) {
      result.status = n;
      return this;
    },
    json(value: unknown) {
      result.body = value;
      return this;
    },
  } as unknown as Response;
  await handlers.get(method)!(
    {
      userId: "owner",
      params: { hostId },
      body: { hostId, command },
    } as unknown as Request,
    res,
    () => {},
  );
  return result;
}
it.each(["1abc", "1.5", "-1", "0", "1e3", "9007199254740993"])(
  "rejects malformed history path %s before querying",
  async (id) => {
    expect((await invoke("get", id)).status).toBe(400);
    expect(db.listCommandsForHost).not.toHaveBeenCalled();
  },
);
it.each(["1", 1.5, -1, 0, {}, 9007199254740992])(
  "rejects invalid deletion host %s before mutation",
  async (id) => {
    expect((await invoke("delete", id)).status).toBe(400);
    expect(db.deleteCommandForHost).not.toHaveBeenCalled();
  },
);
it.each([{}, [], 12, "", "   "])(
  "rejects invalid command type or empty command %s",
  async (command) => {
    expect((await invoke("delete", 1, command)).status).toBe(400);
    expect(db.deleteCommandForHost).not.toHaveBeenCalled();
  },
);
it("preserves valid command bytes and scopes both operations to the authenticated user", async () => {
  expect((await invoke("get", "12")).body).toEqual(["pwd"]);
  expect(db.listCommandsForHost).toHaveBeenCalledWith("owner", 12);
  expect((await invoke("delete", 12, '  printf "中文"  ')).status).toBe(200);
  expect(db.deleteCommandForHost).toHaveBeenCalledWith(
    "owner",
    12,
    '  printf "中文"  ',
  );
});
