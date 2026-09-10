import { EventEmitter } from "node:events";
import type { Express, RequestHandler } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { registerFileActionRoutes } from "../../../hosts/file-manager/action-routes.js";
import {
  execChannel,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
vi.mock("../../../hosts/file-manager/session.js", () => ({
  execChannel: vi.fn(),
}));
vi.mock("../../../utils/logger.js", () => ({
  fileLogger: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
async function invoke(permissions: unknown, owned = true) {
  const routes = new Map<string, RequestHandler>();
  const app = {
    post: (path: string, handler: RequestHandler) => routes.set(path, handler),
  } as unknown as Express;
  registerFileActionRoutes(app, {
    sshSessions: { test: { isConnected: true } as SSHSession },
    scheduleSessionCleanup: vi.fn(),
    verifySessionOwnership: () => owned,
  });
  const status = vi.fn().mockReturnThis(),
    json = vi.fn();
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
  });
  vi.mocked(execChannel).mockImplementation((_session, _command, callback) => {
    callback(null, stream as never);
    stream.emit("close", 0);
  });
  await routes.get("/ssh/file_manager/ssh/changePermissions")!(
    {
      body: { sessionId: "test", path: "/srv/共享", permissions },
      userId: "owner",
    } as never,
    { status, json, headersSent: false } as never,
    vi.fn(),
  );
  return { status, json };
}
it.each(["1777", "2755", "0755", "644"])(
  "transmits all mode bits for %s",
  async (mode) => {
    const result = await invoke(mode);
    expect(execChannel).toHaveBeenCalledWith(
      expect.anything(),
      `chmod ${mode.padStart(5, "0")} -- '/srv/共享' && echo "SUCCESS"`,
      expect.any(Function),
    );
    expect(result.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  },
);
it.each(["888", "9999", "77", "77777", 755, "755;id"])(
  "rejects invalid octal input %s before SSH",
  async (mode) => {
    expect((await invoke(mode)).status).toHaveBeenCalledWith(400);
    expect(execChannel).not.toHaveBeenCalled();
  },
);
it("retains session ownership enforcement", async () => {
  expect((await invoke("1777", false)).status).toHaveBeenCalledWith(403);
  expect(execChannel).not.toHaveBeenCalled();
});
