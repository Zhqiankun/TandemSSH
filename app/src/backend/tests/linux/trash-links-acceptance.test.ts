import { afterEach, expect, it } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import {
  listTrash,
  moveToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "../../hosts/file-manager/trash-service.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "preserves relative links in trash and deletes only link entries over real SFTP",
  async () => {
    const f = await linuxFixture();
    closers.push(() => f.close());
    // Resolve the trash home to this test's private directory; all operations remain real SFTP.
    const sftp = new Proxy(f.sftp, {
      get(target, key) {
        if (key === "realpath")
          return (
            value: string,
            callback: Parameters<SFTPWrapper["realpath"]>[1],
          ) => target.realpath(value === "." ? f.root : value, callback);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const target = f.root + "/kept",
      link = f.root + "/relative-link";
    await new Promise<void>((resolve, reject) =>
      f.sftp.mkdir(target, (error) => (error ? reject(error) : resolve())),
    );
    await f.write(target + "/keep.txt", "protected target");
    await new Promise<void>((resolve, reject) =>
      f.sftp.symlink("kept", link, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const item = await moveToTrash(sftp, link);
    expect(await listTrash(sftp, 7)).toEqual([item]);
    await restoreTrashItem(sftp, item.id);
    expect((await f.io.stat(link)).kind).toBe("symlink");
    expect(await f.io.resolve(link)).toBe(target);
    const again = await moveToTrash(sftp, link);
    await permanentlyDeleteTrashItem(sftp, again.id);
    expect(await f.exists(f.root + "/.termix-trash/files/" + again.id)).toBe(
      false,
    );
    expect((await f.read(target + "/keep.txt")).toString()).toBe(
      "protected target",
    );
    const broken = f.root + "/断链";
    await new Promise<void>((resolve, reject) =>
      f.sftp.symlink("missing", broken, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const dangling = await moveToTrash(sftp, broken);
    expect(await listTrash(sftp, 7)).toEqual([dangling]);
    await permanentlyDeleteTrashItem(sftp, dangling.id);
    expect(await f.exists(f.root + "/.termix-trash/files/" + dangling.id)).toBe(
      false,
    );
    expect(await listTrash(sftp, 7)).toEqual([]);
  },
  45000,
);
