import { expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { deletePathSftp } from "../../../hosts/file-manager/transfer-sftp-dir.js";
it.each([2, "ENOENT", 3, "EACCES"])(
  "ignores only missing paths, not lookup failure %s",
  async (code) => {
    const error = Object.assign(Error("lookup failed"), { code });
    const unlink = vi.fn();
    const sftp = {
      lstat: (_path: string, done: (e: Error) => void) => done(error),
      unlink,
    } as unknown as SFTPWrapper;
    const deletion = deletePathSftp(sftp, "/source");
    if (code === 2 || code === "ENOENT")
      await expect(deletion).resolves.toBeUndefined();
    else await expect(deletion).rejects.toBe(error);
    expect(unlink).not.toHaveBeenCalled();
  },
);
it("unlinks a directory symlink without listing or touching its target", async () => {
  const unlink = vi.fn((_path, done) => done(null)),
    readdir = vi.fn();
  const sftp = {
    lstat: (_path: string, done: (e: null, stats: object) => void) =>
      done(null, {
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
      }),
    unlink,
    readdir,
  } as unknown as SFTPWrapper;
  await deletePathSftp(sftp, "/source/link");
  expect(unlink).toHaveBeenCalledWith("/source/link", expect.any(Function));
  expect(readdir).not.toHaveBeenCalled();
});
it("propagates a child deletion failure and does not remove its parent", async () => {
  const error = Error("permission denied"),
    rmdir = vi.fn(),
    unlink = vi.fn((_path, done) => done(error));
  const sftp = {
    lstat: (path: string, done: (e: null, stats: object) => void) =>
      done(null, {
        isDirectory: () => path === "/source",
        isFile: () => path !== "/source",
      }),
    readdir: (_path: string, done: (e: null, entries: object[]) => void) =>
      done(null, [{ filename: "file" }]),
    unlink,
    rmdir,
  } as unknown as SFTPWrapper;
  await expect(deletePathSftp(sftp, "/source")).rejects.toBe(error);
  expect(rmdir).not.toHaveBeenCalled();
});
