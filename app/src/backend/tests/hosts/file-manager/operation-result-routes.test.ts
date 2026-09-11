import { createFileItem } from "../../../hosts/file-manager/create-item.js";
import type { Express, RequestHandler } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { registerFileOperationRoutes } from "../../../hosts/file-manager/operation-routes.js";
import {
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
