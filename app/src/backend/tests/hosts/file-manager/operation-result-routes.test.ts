import { EventEmitter } from "node:events";
import {
  listTrash,
  moveToTrash,
} from "../../../hosts/file-manager/trash-service.js";
import { createFileItem } from "../../../hosts/file-manager/create-item.js";
import type { Express, RequestHandler } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { registerFileOperationRoutes } from "../../../hosts/file-manager/operation-routes.js";
import {
  execWithSudo,
  execChannel,
  getSessionSftp,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
vi.mock("../../../hosts/file-manager/session.js", () => ({
  execChannel: vi.fn(),
  execWithSudo: vi.fn(),
  getSessionSftp: vi.fn(),
}));
vi.mock("../../../utils/logger.js", () => ({
  fileLogger: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: vi.fn(),
  getCurrentSettingValue: vi.fn(),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ isAdmin: async () => false }) },
}));
vi.mock(
  "../../../hosts/file-manager/create-item.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../hosts/file-manager/create-item.js")
    >()),
    createFileItem: vi.fn(),
  }),
);
vi.mock("../../../hosts/file-manager/trash-service.js", async (original) => ({
  ...(await original<
    typeof import("../../../hosts/file-manager/trash-service.js")
  >()),
  listTrash: vi.fn(),
  moveToTrash: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it.each(["createFile", "createFolder"])(
  "%s maps SFTP conflicts and permission failures",
  async (name) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
        patch: register,
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        verifySessionOwnership: () => true,
      },
    );
    vi.mocked(getSessionSftp).mockResolvedValue({} as never);
    for (const [error, statusCode] of [
      [Error("FILE_TARGET_EXISTS"), 409],
      [Object.assign(Error("denied"), { code: 3 }), 403],
      [Error("CREATE_RESULT_UNKNOWN"), 500],
    ] as const) {
      vi.mocked(createFileItem).mockRejectedValueOnce(error);
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      await routes.get("/ssh/file_manager/ssh/" + name)!(
        {
          userId: "owner",
          body: {
            sessionId: "session",
            path: "/target",
            fileName: "name",
            folderName: "name",
          },
        } as never,
        { status, json } as never,
        vi.fn(),
      );
      expect(status).toHaveBeenCalledWith(statusCode);
      expect(execChannel).not.toHaveBeenCalled();
    }
  },
);
it.each(["false", "true", 1, 0, null, {}])(
  "rejects non-boolean deletion options %j before remote access",
  async (invalid) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        verifySessionOwnership: () => true,
      },
    );
    for (const field of ["permanent", "isDirectory"]) {
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      await routes.get("/ssh/file_manager/ssh/deleteItem")!(
        {
          userId: "owner",
          body: { sessionId: "session", path: "/srv/file", [field]: invalid },
        } as never,
        { status, json } as never,
        vi.fn(),
      );
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: "INVALID_DELETE_OPTIONS" });
      expect(execChannel).not.toHaveBeenCalled();
    }
  },
);

it.each(["renameItem", "moveItem"])(
  "returns an explicit %s conflict without invoking a shell command",
  async (route) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        verifySessionOwnership: () => true,
      },
    );
    const rename = vi.fn();
    vi.mocked(getSessionSftp).mockResolvedValue({
      lstat: (_path: string, done: (error: null, attributes: object) => void) =>
        done(null, {}),
      rename,
    } as never);
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    await routes.get("/ssh/file_manager/ssh/" + route)!(
      {
        userId: "owner",
        body: {
          sessionId: "session",
          oldPath: "/srv/source",
          newName: "target",
          newPath: "/srv/target",
        },
      } as never,
      { status, json } as never,
      vi.fn(),
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: "FILE_TARGET_EXISTS" });
    expect(rename).not.toHaveBeenCalled();
    expect(execChannel).not.toHaveBeenCalled();
  },
);

it.each([
  "prepare-failed",
  "move-failed",
  "move-applied-response-lost",
] as const)(
  "does not suggest permanent deletion for an unconfirmed move: %s",
  async (scenario) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        verifySessionOwnership: () => true,
      },
    );
    vi.mocked(getSessionSftp).mockResolvedValue({} as never);
    const applied: string[] = [];
    vi.mocked(listTrash).mockImplementation(async () => {
      if (scenario === "prepare-failed") throw Error("trash unavailable");
      return [];
    });
    vi.mocked(moveToTrash).mockImplementation(async (_sftp, source) => {
      if (scenario === "move-applied-response-lost") applied.push(source);
      throw Error("move response unavailable");
    });
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    await routes.get("/ssh/file_manager/ssh/deleteItem")!(
      {
        userId: "owner",
        body: { sessionId: "session", path: "/srv/file", permanent: false },
      } as never,
      { status, json } as never,
      vi.fn(),
    );
    if (scenario === "prepare-failed") {
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({
        error: "trash unavailable",
        trashUnavailable: true,
      });
      expect(moveToTrash).not.toHaveBeenCalled();
    } else {
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: "TRASH_RESULT_UNKNOWN",
        trashUnavailable: false,
      });
      expect(moveToTrash).toHaveBeenCalledTimes(1);
    }
    expect(applied).toEqual(
      scenario === "move-applied-response-lost" ? ["/srv/file"] : [],
    );
    expect(execChannel).not.toHaveBeenCalled();
  },
);

it.each([
  "split-denied",
  "split-not-permitted",
  "successful-warning",
  "missing-exit",
  "error-then-close",
  "close-then-error",
] as const)(
  "settles permanent deletion once and only requests sudo for confirmed permission failures: %s",
  async (scenario) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      {
        sshSessions: { session: { isConnected: true } as SSHSession },
        verifySessionOwnership: () => true,
      },
    );
    const stream = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    vi.mocked(execChannel).mockImplementation(
      (_session, _command, callback) => {
        callback(undefined, stream as never);
        stream.stderr.emit(
          "data",
          Buffer.from(
            scenario === "split-not-permitted"
              ? "Operation not "
              : "Permission ",
          ),
        );
        stream.stderr.emit(
          "data",
          Buffer.from(
            scenario === "split-not-permitted" ? "permitted" : "denied",
          ),
        );
        if (
          scenario === "successful-warning" ||
          scenario === "close-then-error"
        )
          stream.emit("data", Buffer.from("SUCCESS\n"));
        if (scenario === "error-then-close")
          stream.emit("error", Error("lost connection"));
        stream.emit(
          "close",
          scenario === "missing-exit"
            ? undefined
            : scenario === "successful-warning" ||
                scenario === "close-then-error"
              ? 0
              : 1,
        );
        if (scenario === "close-then-error")
          stream.emit("error", Error("late close error"));
      },
    );
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    await routes.get("/ssh/file_manager/ssh/deleteItem")!(
      {
        userId: "owner",
        body: { sessionId: "session", path: "/srv/file", permanent: true },
      } as never,
      { status, json } as never,
      vi.fn(),
    );
    expect(execChannel).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    if (scenario === "split-denied" || scenario === "split-not-permitted") {
      expect(status).toHaveBeenCalledWith(403);
      expect(json.mock.calls[0][0].needsSudo).toBe(true);
    } else if (scenario === "missing-exit" || scenario === "error-then-close") {
      expect(status).toHaveBeenCalledWith(500);
      expect(json.mock.calls[0][0].needsSudo).not.toBe(true);
      expect(json.mock.calls[0][0].error).toBe("DELETE_RESULT_UNKNOWN");
    } else {
      expect(status).not.toHaveBeenCalled();
      expect(json.mock.calls[0][0].message).toBe("Item deleted successfully");
    }
  },
);

it.each(["failure", "rejection", "success", "new-password"] as const)(
  "clears only failed sudo credentials and permits a new prompt: %s",
  async (scenario) => {
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    const session = {
      isConnected: true,
      sudoPassword: "old-password",
    } as SSHSession;
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      { sshSessions: { session }, verifySessionOwnership: () => true },
    );
    vi.mocked(execChannel).mockImplementation(
      (_session, _command, callback) => {
        const stream = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        callback(undefined, stream as never);
        stream.stderr.emit("data", Buffer.from("Permission denied"));
        stream.emit("close", 1);
      },
    );
    vi.mocked(execWithSudo).mockImplementation(async () => {
      if (scenario === "new-password") session.sudoPassword = "new-password";
      if (scenario === "rejection") throw Error("private diagnostic");
      return {
        code: scenario === "success" ? 0 : 1,
        stdout: "",
        stderr: "private diagnostic",
      };
    });
    const request = async () => {
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      await routes.get("/ssh/file_manager/ssh/deleteItem")!(
        {
          userId: "owner",
          body: { sessionId: "session", path: "/srv/file", permanent: true },
        } as never,
        { status, json } as never,
        vi.fn(),
      );
      expect(json).toHaveBeenCalledTimes(1);
      return { status, body: json.mock.calls[0][0] };
    };
    const first = await request();
    expect(execWithSudo).toHaveBeenCalledTimes(1);
    if (scenario === "success") {
      expect(session.sudoPassword).toBe("old-password");
      expect(first.body.message).toBe("Item deleted successfully");
    } else {
      expect(first.status).toHaveBeenCalledWith(500);
      expect(first.body).toEqual({ error: "SUDO_DELETE_FAILED" });
      if (scenario === "new-password")
        expect(session.sudoPassword).toBe("new-password");
      else {
        expect(session.sudoPassword).toBeUndefined();
        const retry = await request();
        expect(retry.status).toHaveBeenCalledWith(403);
        expect(retry.body.needsSudo).toBe(true);
        expect(execWithSudo).toHaveBeenCalledTimes(1);
      }
    }
  },
);

it.each(["disconnected", "replaced"] as const)(
  "does not dispatch a queued delete after its session is %s",
  async (change) => {
    const actual = await vi.importActual<
      typeof import("../../../hosts/file-manager/session.js")
    >("../../../hosts/file-manager/session.js");
    vi.mocked(execChannel).mockImplementation(actual.execChannel);
    const opener = new actual.ChannelOpenSerializer();
    let release!: () => void;
    const held = opener.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const clientExec = vi.fn();
    const session = {
      isConnected: true,
      channelOpener: opener,
      client: { exec: clientExec },
    } as unknown as SSHSession;
    const sessions = { session };
    const routes = new Map<string, RequestHandler>();
    const register = (path: string, handler: RequestHandler) =>
      routes.set(path, handler);
    registerFileOperationRoutes(
      {
        get: register,
        post: register,
        put: register,
        delete: register,
      } as unknown as Express,
      { sshSessions: sessions, verifySessionOwnership: () => true },
    );
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    const request = routes.get("/ssh/file_manager/ssh/deleteItem")!(
      {
        userId: "owner",
        body: { sessionId: "session", path: "/srv/file", permanent: true },
      } as never,
      { status, json } as never,
      vi.fn(),
    );
    if (change === "disconnected") session.isConnected = false;
    else sessions.session = { ...session };
    release();
    await held;
    await request;
    expect(clientExec).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledExactlyOnceWith({
      error: "DELETE_NOT_DISPATCHED",
    });
  },
);

it.each(["queued", "negotiating", "active", "completed"] as const)(
  "bounds deletion in the %s phase and ignores late results",
  async (phase) => {
    vi.useFakeTimers();
    try {
      const routes = new Map<string, RequestHandler>();
      const register = (path: string, handler: RequestHandler) =>
        routes.set(path, handler);
      registerFileOperationRoutes(
        {
          get: register,
          post: register,
          put: register,
          delete: register,
        } as unknown as Express,
        {
          sshSessions: {
            session: {
              isConnected: true,
              sudoPassword: "cached",
            } as SSHSession,
          },
          verifySessionOwnership: () => true,
        },
      );
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy: vi.fn(),
      });
      let open!: Parameters<typeof execChannel>[2];
      let guard!: () => void;
      vi.mocked(execChannel).mockImplementation(
        (_session, _command, callback, beforeOpen) => {
          open = callback;
          guard = beforeOpen!;
          if (phase !== "queued") guard();
          if (phase === "active" || phase === "completed")
            callback(undefined, stream as never);
          if (phase === "completed") {
            stream.emit("data", Buffer.from("SUCCESS\n"));
            stream.emit("close", 0);
          }
        },
      );
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      const request = routes.get("/ssh/file_manager/ssh/deleteItem")!(
        {
          userId: "owner",
          body: { sessionId: "session", path: "/srv/file", permanent: true },
        } as never,
        { status, json } as never,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(60000);
      await request;
      expect(json).toHaveBeenCalledTimes(1);
      if (phase === "completed") {
        expect(status).not.toHaveBeenCalled();
        expect(stream.destroy).not.toHaveBeenCalled();
      } else {
        expect(status).toHaveBeenCalledWith(500);
        expect(json.mock.calls[0][0].error).toBe(
          phase === "queued"
            ? "DELETE_NOT_DISPATCHED"
            : "DELETE_RESULT_UNKNOWN",
        );
        expect(() => guard()).toThrow("DELETE_NOT_DISPATCHED");
        if (phase !== "active") open(undefined, stream as never);
        expect(stream.destroy).toHaveBeenCalledTimes(1);
        stream.emit("data", Buffer.from("SUCCESS\n"));
        stream.stderr.emit("data", Buffer.from("Permission denied"));
        stream.emit("close", 1);
        expect(json).toHaveBeenCalledTimes(1);
        expect(execWithSudo).not.toHaveBeenCalled();
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);
