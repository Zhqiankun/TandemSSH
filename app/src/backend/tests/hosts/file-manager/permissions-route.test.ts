import { EventEmitter } from "node:events";
import type { Express, RequestHandler } from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
afterEach(() => vi.useRealTimers());
async function invoke(
  permissions: unknown,
  owned = true,
  response = { code: 0, stdout: "SUCCESS\n", stderr: "" },
  targetPath: unknown = "/srv/共享",
  controls: { queued?: boolean; hang?: boolean } = {},
) {
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
    close: vi.fn(),
  });
  let dispatches = 0,
    releaseOpen = () => {};
  vi.mocked(execChannel).mockImplementation(
    (_session, _command, callback, beforeOpen) => {
      releaseOpen = () => {
        try {
          beforeOpen?.();
        } catch (error) {
          callback(error as Error, undefined as never);
          return;
        }
        dispatches++;
        callback(undefined, stream as never);
        if (!controls.hang) {
          stream.emit("data", Buffer.from(response.stdout));
          stream.stderr.emit("data", Buffer.from(response.stderr));
          stream.emit("close", response.code);
        }
      };
      if (!controls.queued) releaseOpen();
    },
  );
  await routes.get("/ssh/file_manager/ssh/changePermissions")!(
    {
      body: { sessionId: "test", path: targetPath, permissions },
      userId: "owner",
    } as never,
    { status, json, headersSent: false } as never,
    vi.fn(),
  );
  return { status, json, stream, releaseOpen, dispatches: () => dispatches };
}
it.each(["1777", "2755", "0755", "644"])(
  "transmits all mode bits for %s",
  async (mode) => {
    const result = await invoke(mode);
    expect(execChannel).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(
        `chmod ${mode.padStart(5, "0")} -- '/srv/共享' && echo "SUCCESS"`,
      ),
      expect.any(Function),
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

it("rejects the explicit remote symlink refusal without reporting success", async () => {
  const result = await invoke("777", true, {
    code: 65,
    stdout: "",
    stderr: "FILE_SYMLINK_TARGET_REQUIRED\n",
  });
  expect(result.status).toHaveBeenCalledWith(409);
  expect(result.json).toHaveBeenCalledWith({
    error: "FILE_SYMLINK_TARGET_REQUIRED",
  });
});
it("does not let a success token override a failing process exit", async () => {
  const result = await invoke("644", true, {
    code: 1,
    stdout: "SUCCESS\n",
    stderr: "denied",
  });
  expect(result.status).toHaveBeenCalledWith(500);
  expect(result.json).not.toHaveBeenCalledWith(
    expect.objectContaining({ success: true }),
  );
});
it("requires the complete success token even for a zero exit", async () => {
  const result = await invoke("644", true, { code: 0, stdout: "", stderr: "" });
  expect(result.status).toHaveBeenCalledWith(500);
  expect(result.json).not.toHaveBeenCalledWith(
    expect.objectContaining({ success: true }),
  );
});

it.each([null, 123, {}, "", "/bad\0path", "/" + "x".repeat(4096)])(
  "rejects malformed permission targets before dispatch %#",
  async (target) => {
    const result = await invoke("644", true, undefined, target);
    expect(result.status).toHaveBeenCalledWith(400);
    expect(execChannel).not.toHaveBeenCalled();
  },
);

it("does not dispatch a queued chmod after its response deadline", async () => {
  vi.useFakeTimers();
  const f = await invoke("644", true, undefined, undefined, { queued: true });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.status).toHaveBeenCalledWith(408);
  f.releaseOpen();
  expect(f.dispatches()).toBe(0);
  expect(f.json).toHaveBeenCalledTimes(1);
});
it("closes an opened chmod channel on timeout and ignores late success", async () => {
  vi.useFakeTimers();
  const f = await invoke("644", true, undefined, undefined, { hang: true });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.stream.close).toHaveBeenCalledTimes(1);
  expect(f.status).toHaveBeenCalledWith(408);
  f.stream.emit("data", Buffer.from("SUCCESS\n"));
  f.stream.emit("close", 0);
  expect(f.json).toHaveBeenCalledTimes(1);
});
