import { expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { createFileItem } from "../../hosts/file-manager/create-item.js";
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "creates literal files and directories exclusively over real OpenSSH",
  async () => {
    const f = await linuxFixture();
    try {
      const literal = "中文 ' $(touch injected)\n-file";
      await createFileItem(f.sftp, f.root, literal, "file");
      expect((await f.read(f.root + "/" + literal)).length).toBe(0);
      await createFileItem(f.sftp, f.root, "目录", "directory");
      expect((await f.io.stat(f.root + "/目录")).kind).toBe("directory");
      await f.write(f.root + "/existing", "original-content");
      await f.write(f.root + "/目录/child", "nested-content");
      const before = await f.io.stat(f.root + "/existing");
      await new Promise<void>((resolve, reject) =>
        f.sftp.symlink("missing", f.root + "/broken", (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      await new Promise<void>((resolve, reject) =>
        f.sftp.symlink("existing", f.root + "/link", (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      for (const kind of ["file", "directory"] as const) {
        for (const name of ["existing", "目录", "broken", "link"]) {
          await expect(
            createFileItem(f.sftp, f.root, name, kind),
          ).rejects.toThrow("FILE_TARGET_EXISTS");
        }
      }
      expect(await f.io.stat(f.root + "/existing")).toEqual(before);
      expect((await f.read(f.root + "/existing")).toString()).toBe(
        "original-content",
      );
      expect((await f.read(f.root + "/目录/child")).toString()).toBe(
        "nested-content",
      );
      expect((await f.io.stat(f.root + "/broken")).kind).toBe("symlink");
      expect((await f.io.stat(f.root + "/link")).kind).toBe("symlink");
      expect(await f.exists(f.root + "/missing")).toBe(false);
      expect(await f.exists(f.root + "/injected")).toBe(false);
      const locked = f.root + "/locked";
      await createFileItem(f.sftp, f.root, "locked", "directory");
      const chmod = (mode: number) =>
        new Promise<void>((resolve, reject) =>
          f.sftp.chmod(locked, mode, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
      await chmod(0o500);
      try {
        for (const kind of ["file", "directory"] as const)
          await expect(
            createFileItem(f.sftp, locked, "denied-" + kind, kind),
          ).rejects.toMatchObject({ code: 3 });
        expect(await f.exists(locked + "/denied-file")).toBe(false);
        expect(await f.exists(locked + "/denied-directory")).toBe(false);
      } finally {
        await chmod(0o700);
      }
      const outcomes = await Promise.allSettled([
        createFileItem(f.sftp, f.root, "race", "file"),
        createFileItem(f.sftp, f.root, "race", "file"),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason.message).toBe(
        "FILE_TARGET_EXISTS",
      );
      expect((await f.read(f.root + "/race")).length).toBe(0);
    } finally {
      await f.close();
    }
  },
  30000,
);
