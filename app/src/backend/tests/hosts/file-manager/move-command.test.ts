import { EventEmitter } from "node:events";
import type { SFTPWrapper } from "ssh2";
import { beforeEach, expect, it, vi } from "vitest";
import {
  execChannel,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
import {
  buildNoClobberMoveCommand,
  moveWithNoClobber,
} from "../../../hosts/file-manager/move-command.js";
vi.mock("../../../hosts/file-manager/session.js", () => ({
  execChannel: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
function fixture(mode: "moved" | "skip" | "lost" | "failed", existing = false) {
  const files = new Set(["/source"]);
  if (existing) files.add("/target");
  const sftp = {
    lstat: (path: string, done: (error?: unknown, stats?: unknown) => void) =>
      files.has(path)
        ? done(null, {})
        : done(Object.assign(Error("missing"), { code: 2 })),
  } as unknown as SFTPWrapper;
  vi.mocked(execChannel).mockImplementation(
    (_session, _command, callback, guard) => {
      guard?.();
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy: vi.fn(),
      });
      callback(undefined, stream as never);
      if (mode === "moved" || mode === "lost") {
        files.delete("/source");
        files.add("/target");
      }
      if (mode === "skip") files.add("/target");
      stream.emit(
        "close",
        mode === "lost" ? undefined : mode === "failed" ? 1 : 0,
      );
    },
  );
  return { sftp, files, session: { isConnected: true } as SSHSession };
}
it("uses no-clobber and an exact destination with literal path quoting", () => {
  expect(buildNoClobberMoveCommand("/source/o'ne\n", "/target/-two")).toBe(
    "mv -n -T -- '/source/o'\"'\"'ne\n' '/target/-two'",
  );
  expect(() => buildNoClobberMoveCommand("C:/source", "D:/target")).toThrow(
    "MOVE_CROSS_DEVICE_UNSUPPORTED",
  );
});
it("requires acknowledged success and source disappearance", async () => {
  const f = fixture("moved");
  await expect(
    moveWithNoClobber(f.session, f.sftp, "/source", "/target"),
  ).resolves.toBeUndefined();
  expect(execChannel).toHaveBeenCalledTimes(1);
});
it.each(["skip", "lost", "failed"] as const)(
  "does not claim success for %s",
  async (mode) => {
    const f = fixture(mode);
    await expect(
      moveWithNoClobber(f.session, f.sftp, "/source", "/target"),
    ).rejects.toThrow(
      mode === "skip" ? "FILE_TARGET_EXISTS" : "MOVE_RESULT_UNKNOWN",
    );
    expect(execChannel).toHaveBeenCalledTimes(1);
  },
);
it("does not invoke a command for an already existing target", async () => {
  const f = fixture("moved", true);
  await expect(
    moveWithNoClobber(f.session, f.sftp, "/source", "/target"),
  ).rejects.toThrow("FILE_TARGET_EXISTS");
  expect(execChannel).not.toHaveBeenCalled();
});
