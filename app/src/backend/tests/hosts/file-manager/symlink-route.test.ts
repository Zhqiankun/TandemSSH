import type { Express, RequestHandler } from "express";
import { afterEach, expect, it, vi } from "vitest";
import { registerSymlinkRoute } from "../../../hosts/file-manager/symlink-route.js";
import {
  getSessionSftp,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
vi.mock("../../../hosts/file-manager/session.js", () => ({
  getSessionSftp: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
function fixture(mode = 0o100644, owned = true) {
  const target = "/srv/中文%2F\n尾部 \n";
  const realpath = vi.fn((_path, done) => done(null, target));
  const lstat = vi.fn((_path, done) =>
    done(null, { mode, size: 0, mtime: 1, atime: 1, uid: 1000, gid: 1000 }),
  );
  vi.mocked(getSessionSftp).mockResolvedValue({ realpath, lstat } as never);
  let handler!: RequestHandler;
  registerSymlinkRoute(
    {
      get: (_name: string, fn: RequestHandler) => {
        handler = fn;
      },
    } as unknown as Express,
    {
      sshSessions: { session: { isConnected: true } as SSHSession },
      verifySessionOwnership: () => owned,
    },
  );
  const invoke = async (path: unknown = "/链接%2F\n") => {
    const json = vi.fn(),
      status = vi.fn().mockReturnThis();
    await handler(
      { query: { sessionId: "session", path }, userId: "owner" } as never,
      { json, status } as never,
      vi.fn(),
    );
    return { json, status };
  };
  return { target, realpath, lstat, invoke };
}
it.each([0o100644, 0o40755])(
  "preserves literal percent and newline paths for mode %s",
  async (mode) => {
    const f = fixture(mode),
      r = await f.invoke();
    expect(f.realpath).toHaveBeenCalledWith("/链接%2F\n", expect.any(Function));
    expect(f.lstat).toHaveBeenCalledWith(f.target, expect.any(Function));
    expect(r.json).toHaveBeenCalledWith({
      path: "/链接%2F\n",
      target: f.target,
      type: mode === 0o100644 ? "file" : "directory",
    });
  },
);
it.each([0o010644, 0o020644, 0o120777])(
  "does not classify special or changed targets as text: %s",
  async (mode) => {
    expect((await fixture(mode).invoke()).status).toHaveBeenCalledWith(500);
  },
);
it.each([undefined, [], "/bad\0name", "a".repeat(4097)])(
  "rejects malformed path before SFTP",
  async (path) => {
    const f = fixture();
    const r = await f.invoke(path === undefined ? null : path);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(getSessionSftp).not.toHaveBeenCalled();
  },
);
it("retains ownership checks", async () => {
  expect((await fixture(0o100644, false).invoke()).status).toHaveBeenCalledWith(
    403,
  );
  expect(getSessionSftp).not.toHaveBeenCalled();
});
it("returns failure for a dangling link", async () => {
  const f = fixture();
  f.lstat.mockImplementation((_path, done) => done({ code: 2 }, undefined));
  expect((await f.invoke()).status).toHaveBeenCalledWith(500);
});
it("bounds a stalled SFTP channel open", async () => {
  vi.useFakeTimers();
  const f = fixture();
  vi.mocked(getSessionSftp).mockReturnValue(new Promise(() => {}));
  const result = f.invoke();
  await vi.advanceTimersByTimeAsync(15001);
  expect((await result).status).toHaveBeenCalledWith(500);
});
