import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";
import { registerSymlinkRoute } from "../../hosts/file-manager/symlink-route.js";
import type { SSHSession } from "../../hosts/file-manager/session.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "resolves literal symlink targets over real HTTP and SFTP and rejects unsafe types",
  async () => {
    const f = await linuxFixture();
    closers.push(() => f.close());
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { userId: "fixture-owner" });
      next();
    });
    registerSymlinkRoute(app, {
      sshSessions: {
        linux: {
          client: f.client,
          sftp: f.sftp,
          isConnected: true,
        } as SSHSession,
      },
      verifySessionOwnership: (_session, user) => user === "fixture-owner",
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    );
    const inspect = async (path: string) => {
      const query = new URLSearchParams({ sessionId: "linux", path });
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/ssh/file_manager/ssh/identifySymlink?${query}`,
        { signal: AbortSignal.timeout(20000) },
      );
      return { status: response.status, body: await response.json() };
    };
    for (const [name, type] of [
      ["中文%2F\n末尾 \n", "file"],
      ["目录%\n", "directory"],
    ] as const) {
      const target = f.root + "/" + name,
        link = f.root + "/链接-" + type + "%2F\n";
      if (type === "file") await f.write(target, "fixture");
      else
        await new Promise<void>((resolve, reject) =>
          f.sftp.mkdir(target, (error) => (error ? reject(error) : resolve())),
        );
      await new Promise<void>((resolve, reject) =>
        f.sftp.symlink(name, link, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      expect(await inspect(link)).toEqual({
        status: 200,
        body: { path: link, target, type },
      });
    }
    const broken = f.root + "/断链",
      loop = f.root + "/循环",
      fifo = f.root + "/管道",
      fifoLink = f.root + "/管道链接";
    expect(
      (
        await f.exec(
          `ln -s missing ${quoteShellWord(broken)} && ln -s ${quoteShellWord(loop)} ${quoteShellWord(loop)} && mkfifo ${quoteShellWord(fifo)} && ln -s ${quoteShellWord(fifo)} ${quoteShellWord(fifoLink)}`,
        )
      ).code,
    ).toBe(0);
    for (const link of [broken, loop, fifoLink])
      expect((await inspect(link)).status).toBe(500);
    expect((await f.io.stat(fifo)).kind).toBe("other");
  },
  45000,
);
