import { EventEmitter } from "node:events";
import type { Express, RequestHandler } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { registerFileOperationRoutes } from "../../../hosts/file-manager/operation-routes.js";
import {
  execChannel,
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
beforeEach(() => vi.clearAllMocks());
it.each(["createFile", "createFolder", "renameItem", "moveItem"])(
  "%s rejects a failure exit even when output contains SUCCESS",
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
    const stream = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    vi.mocked(execChannel).mockImplementation(
      (_session, _command, callback) => {
        callback(undefined, stream as never);
        stream.emit("data", Buffer.from("SUCCESS\n"));
        stream.stderr.emit("data", Buffer.from("failure"));
        stream.emit("close", 1);
      },
    );
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    const handler = routes.get("/ssh/file_manager/ssh/" + name);
    expect(handler).toBeDefined();
    await handler!(
      {
        userId: "owner",
        body: {
          sessionId: "session",
          path: "/srv",
          fileName: "file",
          folderName: "folder",
          oldPath: "/srv/old",
          newName: "new",
          newPath: "/srv/new",
        },
      } as never,
      { status, json, headersSent: false } as never,
      vi.fn(),
    );
    expect(vi.mocked(execChannel).mock.calls[0][1]).toMatch(
      /^(touch|mkdir -p|mv) -- /,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).not.toHaveBeenCalledWith(
      expect.objectContaining({
        toast: expect.objectContaining({ type: "success" }),
      }),
    );
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
