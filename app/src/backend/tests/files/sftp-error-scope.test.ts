import { expect, it } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { SftpFileIO } from "../../files/sftp-io.js";
function fixture(error: Error & { code?: number }) {
  const fail = (...args: unknown[]) =>
    (args.at(-1) as (e: Error) => void)(error);
  return new SftpFileIO({
    lstat: fail,
    rename: fail,
    ext_openssh_rename: fail,
  } as unknown as SFTPWrapper);
}
it.each([
  Object.assign(Error("unsupported"), { code: 8 }),
  Error("Server does not support extension"),
])(
  "does not classify a read failure as unsupported atomic overwrite: %s",
  async (error) => {
    await expect(fixture(error).stat("/file")).rejects.toMatchObject({
      message: "FILE_IO_FAILED",
    });
  },
);
it("does not classify an unsupported no-overwrite rename as atomic overwrite", async () => {
  await expect(
    fixture(Object.assign(Error("unsupported"), { code: 8 })).replace(
      "/source",
      "/target",
      false,
      () => {},
    ),
  ).rejects.toMatchObject({ message: "FILE_IO_FAILED" });
});
it.each([
  Object.assign(Error("unsupported"), { code: 8 }),
  Error("Server does not support extension"),
])(
  "preserves the specific error when atomic overwrite is actually requested: %s",
  async (error) => {
    await expect(
      fixture(error).replace("/source", "/target", true, () => {}),
    ).rejects.toMatchObject({
      message: "FILE_ATOMIC_REPLACE_UNSUPPORTED",
      details: { commitMayHaveOccurred: false },
    });
  },
);
it.each([
  [2, "FILE_NOT_FOUND"],
  [3, "FILE_PERMISSION_DENIED"],
] as const)("retains definite SFTP failure %s", async (code, message) => {
  await expect(
    fixture(
      Object.assign(Error("server detail must not escape"), { code }),
    ).stat("/file"),
  ).rejects.toMatchObject({ message });
});
