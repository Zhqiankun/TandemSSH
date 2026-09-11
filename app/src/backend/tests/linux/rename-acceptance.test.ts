import { afterEach, expect, it } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { renameFileItem } from "../../hosts/file-manager/rename-item.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "renames literal paths and refuses existing files, directories and links over OpenSSH",
  async () => {
    const f = await linuxFixture();
    cleanup.push(() => f.close());
    const source = f.root + "/source",
      target = f.root + "/target";
    await f.write(source, "source-content");
    await f.write(target, "target-content");
    await expect(renameFileItem(f.sftp, source, "target")).rejects.toThrow(
      "FILE_TARGET_EXISTS",
    );
    expect((await f.read(source)).toString()).toBe("source-content");
    expect((await f.read(target)).toString()).toBe("target-content");
    const directory = f.root + "/existing-directory";
    await new Promise<void>((resolve, reject) =>
      f.sftp.mkdir(directory, (error) => (error ? reject(error) : resolve())),
    );
    await expect(
      renameFileItem(f.sftp, source, "existing-directory"),
    ).rejects.toThrow("FILE_TARGET_EXISTS");
    expect(await f.exists(directory + "/source")).toBe(false);
    const broken = f.root + "/broken";
    await new Promise<void>((resolve, reject) =>
      f.sftp.symlink("missing", broken, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await expect(renameFileItem(f.sftp, source, "broken")).rejects.toThrow(
      "FILE_TARGET_EXISTS",
    );
    expect((await f.io.stat(broken)).kind).toBe("symlink");
    const literal = "中文;$(touch injected)\nfile.txt";
    await renameFileItem(f.sftp, source, literal);
    expect((await f.read(f.root + "/" + literal)).toString()).toBe(
      "source-content",
    );
    expect(await f.exists(source)).toBe(false);
    expect(await f.exists(f.root + "/injected")).toBe(false);
    await renameFileItem(f.sftp, broken, "renamed-link");
    expect((await f.io.stat(f.root + "/renamed-link")).kind).toBe("symlink");
  },
  30000,
);
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "lets OpenSSH refuse a destination created after the client precheck",
  async () => {
    const f = await linuxFixture();
    cleanup.push(() => f.close());
    const source = f.root + "/source",
      target = f.root + "/racing-target";
    await f.write(source, "original");
    let injected = false;
    const sftp = new Proxy(f.sftp, {
      get(real, key) {
        if (key === "lstat")
          return (
            name: string,
            callback: Parameters<SFTPWrapper["lstat"]>[1],
          ) => {
            if (name === target && !injected) {
              injected = true;
              void f.write(target, "racing-content").then(
                () =>
                  callback(
                    Object.assign(Error("precheck saw missing"), { code: 2 }),
                    undefined as never,
                  ),
                (error) => callback(error, undefined as never),
              );
            } else real.lstat(name, callback);
          };
        const value = Reflect.get(real, key);
        return typeof value === "function" ? value.bind(real) : value;
      },
    });
    await expect(renameFileItem(sftp, source, "racing-target")).rejects.toThrow(
      "FILE_TARGET_EXISTS",
    );
    expect((await f.read(source)).toString()).toBe("original");
    expect((await f.read(target)).toString()).toBe("racing-content");
  },
  30000,
);
