import { EventEmitter } from "node:events";
import type { Express, RequestHandler } from "express";
import { afterEach, expect, it, vi } from "vitest";
import { registerOwnershipRoute } from "../../../hosts/file-manager/ownership-route.js";
import {
  execChannel,
  getSessionSftp,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
vi.mock("../../../hosts/file-manager/session.js", () => ({
  execChannel: vi.fn(),
  getSessionSftp: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
function fixture(
  options: {
    owned?: boolean;
    exit?: number;
    returnedUid?: number;
    stall?: boolean;
  } = {},
) {
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    close: vi.fn(),
  });
  vi.mocked(execChannel).mockImplementation((_session, _cmd, callback) => {
    callback(undefined, stream as never);
    if (!options.stall)
      queueMicrotask(() => stream.emit("close", options.exit ?? 0));
  });
  vi.mocked(getSessionSftp).mockResolvedValue({
    lstat: (_path: string, done: (error: unknown, value: unknown) => void) =>
      done(null, {
        mode: 0o100644,
        uid: options.returnedUid ?? 1000,
        gid: 1000,
        size: 0,
        mtime: 1,
        atime: 1,
      }),
  } as never);
  let handler!: RequestHandler;
  registerOwnershipRoute(
    {
      post: (_name: string, fn: RequestHandler) => {
        handler = fn;
      },
    } as unknown as Express,
    {
      sshSessions: { test: { isConnected: true } as SSHSession },
      verifySessionOwnership: () => options.owned ?? true,
    },
  );
  const invoke = async (overrides = {}) => {
    const status = vi.fn().mockReturnThis(),
      json = vi.fn();
    await handler(
      {
        body: {
          sessionId: "test",
          path: "/srv/a'$(touch marker)\n",
          uid: 1000,
          gid: 1000,
          ...overrides,
        },
        userId: "owner",
      } as never,
      { status, json } as never,
      vi.fn(),
    );
    return { status, json };
  };
  return { invoke, stream };
}
it("uses no-follow ownership change and reports only verified IDs", async () => {
  const f = fixture(),
    r = await f.invoke();
  expect(execChannel).toHaveBeenCalledWith(
    expect.anything(),
    "chown -h -- 1000:1000 '/srv/a'\\''$(touch marker)\n'",
    expect.any(Function),
    expect.any(Function),
  );
  expect(r.json).toHaveBeenCalledWith({
    success: true,
    uid: 1000,
    gid: 1000,
    mode: 0o100644,
  });
});
it.each([
  { uid: -1 },
  { gid: 4294967295 },
  { uid: "1000" },
  { gid: 1.5 },
  { path: "/bad\0" },
  { path: "relative" },
  { sudo: true },
])("rejects invalid ownership input %j", async (input) => {
  expect((await fixture().invoke(input)).status).toHaveBeenCalledWith(400);
  expect(execChannel).not.toHaveBeenCalled();
});
it("refuses another user's session", async () => {
  expect(
    (await fixture({ owned: false }).invoke()).status,
  ).toHaveBeenCalledWith(403);
  expect(execChannel).not.toHaveBeenCalled();
});
it("does not report success after server permission denial", async () => {
  expect((await fixture({ exit: 1 }).invoke()).status).toHaveBeenCalledWith(
    500,
  );
  expect(getSessionSftp).not.toHaveBeenCalled();
});
it("rejects a mismatched readback", async () => {
  const r = await fixture({ returnedUid: 2000 }).invoke();
  expect(r.json).toHaveBeenCalledWith({ error: "FILE_OWNERSHIP_UNCONFIRMED" });
});
it("times out without retry and closes its execution channel", async () => {
  vi.useFakeTimers();
  const f = fixture({ stall: true }),
    pending = f.invoke();
  await vi.advanceTimersByTimeAsync(15001);
  expect((await pending).status).toHaveBeenCalledWith(500);
  expect(execChannel).toHaveBeenCalledTimes(1);
  expect(f.stream.close).toHaveBeenCalled();
});

it("revokes queued execution admission after timeout", async () => {
  vi.useFakeTimers();
  const f = fixture();
  vi.mocked(execChannel).mockImplementation(() => {});
  const pending = f.invoke();
  const beforeOpen = vi.mocked(execChannel).mock.calls[0][3]!;
  expect(() => beforeOpen()).not.toThrow();
  await vi.advanceTimersByTimeAsync(15001);
  expect((await pending).status).toHaveBeenCalledWith(500);
  expect(() => beforeOpen()).toThrow("FILE_OWNERSHIP_UNCONFIRMED");
});
it("checks admission inside the real channel queue before client.exec", async () => {
  const actual = await vi.importActual<
    typeof import("../../../hosts/file-manager/session.js")
  >("../../../hosts/file-manager/session.js");
  const queue = new actual.ChannelOpenSerializer();
  let release!: () => void;
  const blocked = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const client = { exec: vi.fn() };
  let active = true;
  const completed = new Promise<Error | undefined>((resolve) =>
    actual.execChannel(
      { client, channelOpener: queue } as unknown as SSHSession,
      "chown",
      (error) => resolve(error),
      () => {
        if (!active) throw Error("expired");
      },
    ),
  );
  active = false;
  release();
  await blocked;
  expect((await completed)?.message).toBe("expired");
  expect(client.exec).not.toHaveBeenCalled();
});
