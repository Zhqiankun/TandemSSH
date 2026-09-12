import { expect, it } from "vitest";
import type { SFTPWrapper } from "ssh2";
import {
  connectLinux,
  linuxFixture,
} from "../../test-helpers/linux-ssh-fixture.js";
import {
  listTrash,
  moveToTrash,
  restoreTrashItem,
} from "../../hosts/file-manager/trash-service.js";

it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "recovers trash after real SSH connections are cut at intent, source and publication boundaries",
  async () => {
    for (const phase of ["intent", "source", "publication"] as const) {
      const f = await linuxFixture();
      const source = f.root + "/中文 ' recovery\n.bin";
      const bytes = Buffer.from(
        Array.from({ length: 65536 }, (_, i) => i % 251),
      );
      await f.write(source, bytes);
      const operation = await connectLinux();
      const closed = new Promise<void>((resolve) =>
        operation.once("close", () => resolve()),
      );
      let cut = false;
      try {
        const raw = await new Promise<SFTPWrapper>((resolve, reject) =>
          operation.sftp((error, sftp) =>
            error ? reject(error) : resolve(sftp),
          ),
        );
        const interrupted = new Proxy(raw, {
          get(real, key) {
            if (key === "realpath")
              return (
                target: string,
                done: Parameters<SFTPWrapper["realpath"]>[1],
              ) => real.realpath(target === "." ? f.root : target, done);
            if (key === "writeFile")
              return (
                target: string,
                data: string,
                done: (error?: Error) => void,
              ) =>
                real.writeFile(target, data, (error) => {
                  if (error) return done(error);
                  if (phase === "intent") {
                    cut = true;
                    operation.destroy();
                    done(Error("SSH_CONNECTION_LOST"));
                  } else done();
                });
            if (key === "rename")
              return (
                from: string,
                to: string,
                done: (error?: Error) => void,
              ) =>
                real.rename(from, to, (error) => {
                  if (error) return done(error);
                  if (
                    (phase === "source" && from === source) ||
                    (phase === "publication" && from.endsWith(".pending"))
                  ) {
                    cut = true;
                    operation.destroy();
                    done(Error("SSH_CONNECTION_LOST"));
                  } else done();
                });
            const value = Reflect.get(real, key);
            return typeof value === "function" ? value.bind(real) : value;
          },
        });
        await expect(moveToTrash(interrupted, source)).rejects.toThrow(
          "SSH_CONNECTION_LOST",
        );
        expect(cut, phase).toBe(true);
        await closed;
        const fresh = await connectLinux();
        try {
          const freshRaw = await new Promise<SFTPWrapper>((resolve, reject) =>
            fresh.sftp((error, sftp) =>
              error ? reject(error) : resolve(sftp),
            ),
          );
          const recovery = new Proxy(freshRaw, {
            get(real, key) {
              if (key === "realpath")
                return (
                  target: string,
                  done: Parameters<SFTPWrapper["realpath"]>[1],
                ) => real.realpath(target === "." ? f.root : target, done);
              const value = Reflect.get(real, key);
              return typeof value === "function" ? value.bind(real) : value;
            },
          });
          const items = await listTrash(recovery, 7);
          if (phase === "intent") {
            expect(items).toEqual([]);
            expect(await f.read(source)).toEqual(bytes);
          } else {
            expect(await f.exists(source)).toBe(false);
            expect(items).toHaveLength(1);
            expect(items[0].originalPath).toBe(source);
            await restoreTrashItem(recovery, items[0].id);
            expect(await f.read(source)).toEqual(bytes);
            expect(await listTrash(recovery, 7)).toEqual([]);
          }
        } finally {
          fresh.end();
        }
      } finally {
        operation.destroy();
        await f.close();
      }
    }
  },
  120000,
);
