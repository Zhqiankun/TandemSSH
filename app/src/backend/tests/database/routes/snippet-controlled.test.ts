import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import { createServer } from "node:http";
const state = vi.hoisted(() => ({
  userId: "owner",
  apiKeyId: undefined as string | undefined,
  snippet: {
    id: 1,
    userId: "owner",
    name: "测试片段",
    content: 'printf "%s" "$INPUT_1"',
    isNote: false,
  },
}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({
    task: { id: "22222222-2222-4222-8222-222222222222" },
  })),
  target: vi.fn(async () => ({ hostId: 7 })),
  session: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
  ssh: vi.fn(),
}));
vi.mock("../../../collaboration/legacy/production.js", () => ({
  legacyCommands: { create: mocks.create },
  legacyTarget: mocks.target,
  legacySessionForHost: mocks.session,
}));
vi.mock("ssh2", () => ({ Client: mocks.ssh }));
vi.mock("../../../utils/auth-manager.js", () => ({
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
      createDataAccessMiddleware:
        () =>
        (_req: express.Request, _res: express.Response, next: () => void) =>
          next(),
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSnippetRepository: () => ({
    findOwnedById: async () => state.snippet,
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentRbacAccessRepository: () => ({}),
  createCurrentUserRepository: () => ({}),
  createCurrentSyncTombstoneRepository: () => ({}),
}));
vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  databaseLogger: { error: vi.fn() },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(),
  getRequestMeta: () => ({}),
}));
import router from "../../../database/routes/snippets.js";
const app = express();
app.use(express.json());
app.use("/snippets", router);
const server = createServer(app);
let base: string;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  vi.clearAllMocks();
  state.apiKeyId = undefined;
  state.snippet.isNote = false;
});
const send = (body: unknown) =>
  fetch(base + "/snippets/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("old snippet HTTP execution now creates a controlled task", () => {
  it("returns awaiting authorization and never creates an SSH client", async () => {
    const response = await send({
      snippetId: 1,
      hostId: 7,
      requestId: "request",
      mode: "automatic",
      inputValues: { INPUT_1: "x; rm /" },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "awaiting-authorization",
      success: false,
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mocks.create.mock.calls[0]).toEqual([
      "owner",
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestId: "request",
        mode: "automatic",
        source: {
          kind: "snippet",
          title: "测试片段",
          content: 'printf "%s" "$INPUT_1"',
          inputs: { INPUT_1: "x; rm /" },
        },
      },
    ]);
    expect(mocks.ssh).not.toHaveBeenCalled();
  });
  it("does not let an API key use the trusted human entry", async () => {
    state.apiKeyId = "key";
    expect((await send({ snippetId: 1, hostId: 7 })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.ssh).not.toHaveBeenCalled();
  });
  it("rejects a host/session mismatch and notes before task creation", async () => {
    expect((await send({ snippetId: 1, hostId: 8 })).status).toBe(409);
    state.snippet.isNote = true;
    expect((await send({ snippetId: 1, hostId: 7 })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
