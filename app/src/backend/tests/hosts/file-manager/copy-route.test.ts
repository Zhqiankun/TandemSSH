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
vi.mock("../../../hosts/file-manager/ownership-route.js", () => ({
  registerOwnershipRoute: vi.fn(),
}));
vi.mock("../../../utils/logger.js", () => ({
  fileLogger: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));
beforeEach(() => vi.clearAllMocks());
const requestEvents = { once: vi.fn(), off: vi.fn() };
const responseEvents = { once: vi.fn(), off: vi.fn() };
it.each([
  "silent-failure",
  "missing-exit",
  "silent-success",
  "stream-error",
  "multiple-output",
])("handles %s exactly once without requiring stdout first", async (mode) => {
  const routes = new Map<string, RequestHandler>();
  registerFileActionRoutes(
    {
      post: (path: string, handler: RequestHandler) =>
        routes.set(path, handler),
    } as unknown as Express,
    {
      sshSessions: { session: { isConnected: true } as SSHSession },
      scheduleSessionCleanup: vi.fn(),
      verifySessionOwnership: () => true,
    },
  );
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
  });
  vi.mocked(execChannel).mockImplementation((_session, command, callback) => {
    expect(command).toMatch(/^cp -R -- /);
    callback(undefined, stream as never);
    if (mode === "stream-error") stream.emit("error", Error("disconnected"));
    else {
      if (mode === "silent-failure")
        stream.stderr.emit("data", Buffer.from("permission denied"));
      if (mode === "multiple-output") {
        stream.emit("data", Buffer.from("one"));
        stream.emit("data", Buffer.from("COPY_SUCCESS"));
      }
      stream.emit(
        "close",
        mode === "missing-exit" ? undefined : mode === "silent-failure" ? 1 : 0,
      );
    }
  });
  const status = vi.fn().mockReturnThis(),
    json = vi.fn();
  await routes.get("/ssh/file_manager/ssh/copyItem")!(
    {
      ...requestEvents,
      userId: "owner",
      body: {
        sessionId: "session",
        sourcePath: "/source/directory",
        targetDir: "/target",
      },
    } as never,
    { ...responseEvents, status, json, headersSent: false } as never,
    vi.fn(),
  );
  expect(json).toHaveBeenCalledTimes(1);
  if (
    mode === "silent-failure" ||
    mode === "stream-error" ||
    mode === "missing-exit"
  )
    expect(status).toHaveBeenCalledWith(500);
  else expect(json.mock.calls[0][0]).toHaveProperty("uniqueName");
});

it.each([
  undefined,
  {},
  { sessionId: "session", sourcePath: [], targetDir: "/target" },
  { sessionId: "session", sourcePath: "/source", targetDir: {} },
  { sessionId: 42, sourcePath: "/source", targetDir: "/target" },
  { sessionId: "session", sourcePath: "/source\0extra", targetDir: "/target" },
  { sessionId: "session", sourcePath: "/source", targetDir: "" },
])("rejects malformed copy input before opening SSH: %j", async (body) => {
  const routes = new Map<string, RequestHandler>();
  registerFileActionRoutes(
    {
      post: (path: string, handler: RequestHandler) =>
        routes.set(path, handler),
    } as unknown as Express,
    {
      sshSessions: { session: { isConnected: true } as SSHSession },
      scheduleSessionCleanup: vi.fn(),
      verifySessionOwnership: () => true,
    },
  );
  const status = vi.fn().mockReturnThis(),
    json = vi.fn();
  await routes.get("/ssh/file_manager/ssh/copyItem")!(
    { ...requestEvents, userId: "owner", body } as never,
    { ...responseEvents, status, json, headersSent: false } as never,
    vi.fn(),
  );
  expect(status).toHaveBeenCalledWith(400);
  expect(json).toHaveBeenCalledWith({ error: "INVALID_COPY_REQUEST" });
  expect(execChannel).not.toHaveBeenCalled();
});
it.each(["missing", "disconnected", "denied"])(
  "does not execute a copy for a %s session",
  async (state) => {
    const routes = new Map<string, RequestHandler>();
    registerFileActionRoutes(
      {
        post: (path: string, handler: RequestHandler) =>
          routes.set(path, handler),
      } as unknown as Express,
      {
        sshSessions:
          state === "missing"
            ? {}
            : {
                session: {
                  isConnected: state !== "disconnected",
                } as SSHSession,
              },
        scheduleSessionCleanup: vi.fn(),
        verifySessionOwnership: () => state !== "denied",
      },
    );
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    await routes.get("/ssh/file_manager/ssh/copyItem")!(
      {
        ...requestEvents,
        userId: "owner",
        body: {
          sessionId: "session",
          sourcePath: "/source",
          targetDir: "/target",
        },
      } as never,
      { ...responseEvents, status, json, headersSent: false } as never,
      vi.fn(),
    );
    expect(status).toHaveBeenCalledWith(state === "denied" ? 403 : 400);
    expect(execChannel).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "expires queued or open copy channels (opened=%s)",
  async (opened) => {
    vi.useFakeTimers();
    try {
      const routes = new Map<string, RequestHandler>();
      registerFileActionRoutes(
        {
          post: (path: string, handler: RequestHandler) =>
            routes.set(path, handler),
        } as unknown as Express,
        {
          sshSessions: { session: { isConnected: true } as SSHSession },
          scheduleSessionCleanup: vi.fn(),
          verifySessionOwnership: () => true,
        },
      );
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy: vi.fn(),
      });
      let complete!: Parameters<typeof execChannel>[2];
      let beforeOpen!: NonNullable<Parameters<typeof execChannel>[3]>;
      vi.mocked(execChannel).mockImplementation(
        (_session, _command, callback, guard) => {
          complete = callback;
          beforeOpen = guard!;
          if (opened) {
            beforeOpen();
            callback(undefined, stream as never);
          }
        },
      );
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      await routes.get("/ssh/file_manager/ssh/copyItem")!(
        {
          ...requestEvents,
          userId: "owner",
          body: {
            sessionId: "session",
            sourcePath: "/source",
            targetDir: "/target",
          },
        } as never,
        { ...responseEvents, status, json, headersSent: false } as never,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(60000);
      expect(status).toHaveBeenCalledWith(500);
      expect(json.mock.calls[0][0].error).toBe("COPY_RESULT_UNKNOWN");
      expect(() => beforeOpen()).toThrow("COPY_NOT_DISPATCHED");
      if (!opened) complete(undefined, stream as never);
      expect(stream.destroy).toHaveBeenCalledTimes(1);
      stream.emit("data", Buffer.from("COPY_SUCCESS"));
      stream.emit("close", 0);
      expect(json).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["request-aborted", "response-closed", "completed"])(
  "cleans up copy lifecycle on %s",
  async (outcome) => {
    const routes = new Map<string, RequestHandler>();
    registerFileActionRoutes(
      {
        post: (path: string, handler: RequestHandler) =>
          routes.set(path, handler),
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        scheduleSessionCleanup: vi.fn(),
        verifySessionOwnership: () => true,
      },
    );
    const request = Object.assign(new EventEmitter(), {
      userId: "owner",
      body: {
        sessionId: "session",
        sourcePath: "/source",
        targetDir: "/target",
      },
    });
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      headersSent: false,
      destroyed: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    });
    const stream = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      destroy: vi.fn(),
    });
    let guard!: NonNullable<Parameters<typeof execChannel>[3]>;
    let callback!: Parameters<typeof execChannel>[2];
    vi.mocked(execChannel).mockImplementation(
      (_session, _command, done, beforeOpen) => {
        guard = beforeOpen!;
        callback = done;
        if (outcome !== "request-aborted") {
          guard();
          done(undefined, stream as never);
        }
      },
    );
    await routes.get("/ssh/file_manager/ssh/copyItem")!(
      request as never,
      response as never,
      vi.fn(),
    );
    if (outcome === "completed") {
      stream.emit("close", 0);
      response.writableEnded = true;
      response.emit("close");
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(stream.destroy).not.toHaveBeenCalled();
    } else {
      if (outcome === "request-aborted") request.emit("aborted");
      else response.emit("close");
      expect(() => guard()).toThrow("COPY_NOT_DISPATCHED");
      if (outcome === "request-aborted") callback(undefined, stream as never);
      expect(stream.destroy).toHaveBeenCalledTimes(1);
      stream.emit("close", 0);
      expect(response.json).not.toHaveBeenCalled();
    }
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  },
);
