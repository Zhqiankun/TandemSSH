import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { moveFileItem } from "../../hosts/file-manager/rename-item.js";
import { moveWithNoClobber } from "../../hosts/file-manager/move-command.js";
import {
  ChannelOpenSerializer,
  type SSHSession,
} from "../../hosts/file-manager/session.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";

it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "moves files, directories and links across real filesystems without replacing a destination",
  async () => {
    const f = await linuxFixture();
    const remoteRoot = "/mnt/tandem-full/move-" + randomUUID();
    const session: SSHSession = {
      client: f.client,
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
      channelOpener: new ChannelOpenSerializer(),
    };
    let fallbacks = 0;
    const move = (source: string, target: string) =>
      moveFileItem(f.sftp, source, target, async (from, to) => {
        fallbacks++;
        await moveWithNoClobber(session, f.sftp, from, to);
      });
    try {
      expect(
        (await f.exec("mkdir -- " + quoteShellWord(remoteRoot))).code,
      ).toBe(0);
      const disks = await f.exec(
        "stat -c %d -- " +
          quoteShellWord(f.root) +
          " " +
          quoteShellWord(remoteRoot),
      );
      expect(disks.code).toBe(0);
      const ids = disks.output.trim().split(/\s+/);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);

      const literal = "/中文 ' $(touch injected)\n-file";
      const bytes = Buffer.from(
        Array.from({ length: 8192 }, (_, i) => i % 256),
      );
      await f.write(f.root + literal, bytes);
      await move(f.root + literal, remoteRoot + literal);
      expect(await f.exists(f.root + literal)).toBe(false);
      expect(await f.read(remoteRoot + literal)).toEqual(bytes);
      expect(fallbacks).toBe(1);
      await move(remoteRoot + literal, f.root + literal);
      expect(await f.read(f.root + literal)).toEqual(bytes);
      expect(await f.exists(remoteRoot + literal)).toBe(false);
      expect(fallbacks).toBe(2);

      expect(
        (await f.exec("mkdir -- " + quoteShellWord(f.root + "/directory")))
          .code,
      ).toBe(0);
      await f.write(f.root + "/directory/child", "nested-content");
      await new Promise<void>((resolve, reject) =>
        f.sftp.symlink("missing", f.root + "/directory/broken", (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      await move(f.root + "/directory", remoteRoot + "/directory");
      expect(await f.exists(f.root + "/directory")).toBe(false);
      expect((await f.read(remoteRoot + "/directory/child")).toString()).toBe(
        "nested-content",
      );
      expect((await f.io.stat(remoteRoot + "/directory/broken")).kind).toBe(
        "symlink",
      );
      expect(fallbacks).toBe(3);
      await move(remoteRoot + "/directory/broken", f.root + "/broken");
      expect((await f.io.stat(f.root + "/broken")).kind).toBe("symlink");
      expect(await f.exists(remoteRoot + "/directory/broken")).toBe(false);
      expect(fallbacks).toBe(4);

      await f.write(f.root + "/source", "keep-source");
      await f.write(remoteRoot + "/target", "keep-target");
      for (const target of ["/target", "/directory"]) {
        await expect(
          move(f.root + "/source", remoteRoot + target),
        ).rejects.toThrow("FILE_TARGET_EXISTS");
        expect((await f.read(f.root + "/source")).toString()).toBe(
          "keep-source",
        );
      }
      expect((await f.read(remoteRoot + "/target")).toString()).toBe(
        "keep-target",
      );
      expect(await f.exists(remoteRoot + "/directory/source")).toBe(false);
      expect(fallbacks).toBe(4);

      // The other writer creates a destination after the final lstat but before mv.
      const raceTarget = remoteRoot + "/race-target";
      const raceSession: SSHSession = {
        ...session,
        client: new Proxy(f.client, {
          get(real, key) {
            if (key === "exec")
              return (
                command: string,
                callback: Parameters<typeof real.exec>[1],
              ) => {
                void f.write(raceTarget, "other-writer").then(
                  () => real.exec(command, callback),
                  (error) => callback(error, undefined as never),
                );
              };
            const value = Reflect.get(real, key);
            return typeof value === "function" ? value.bind(real) : value;
          },
        }),
      };
      await expect(
        moveWithNoClobber(raceSession, f.sftp, f.root + "/source", raceTarget),
      ).rejects.toThrow("FILE_TARGET_EXISTS");
      expect((await f.read(f.root + "/source")).toString()).toBe("keep-source");
      expect((await f.read(raceTarget)).toString()).toBe("other-writer");

      const large = Buffer.alloc(2 * 1024 * 1024, 0x5a);
      await f.write(f.root + "/large", large);
      await expect(
        move(f.root + "/large", remoteRoot + "/large"),
      ).rejects.toThrow("MOVE_RESULT_UNKNOWN");
      expect(await f.read(f.root + "/large")).toEqual(large);
    } finally {
      // Only this UUID directory on the owned fixture VM is eligible for cleanup.
      expect(remoteRoot).toMatch(/^\/mnt\/tandem-full\/move-[0-9a-f-]{36}$/);
      try {
        expect(
          (await f.exec("rm -rf -- " + quoteShellWord(remoteRoot))).code,
        ).toBe(0);
      } finally {
        await f.close();
      }
    }
  },
  60000,
);
