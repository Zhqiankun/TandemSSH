import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { registerOwnershipRoute } from "../../hosts/file-manager/ownership-route.js";
import {
  ChannelOpenSerializer,
  type SSHSession,
} from "../../hosts/file-manager/session.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "changes only authorized ownership through real HTTP and OpenSSH without following links",
  async () => {
    const f = await linuxFixture();
    closers.push(() => f.close());
    const groups = await f.exec("id -G");
    expect(groups.code).toBe(0);
    expect(groups.output.trim().split(/\s+/)).toContain("1600");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { userId: "fixture-owner" });
      next();
    });
    registerOwnershipRoute(app, {
      sshSessions: {
        linux: {
          client: f.client,
          sftp: f.sftp,
          isConnected: true,
          channelOpener: new ChannelOpenSerializer(),
        } as SSHSession,
      },
      verifySessionOwnership: (_s, user) => user === "fixture-owner",
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
    const change = async (path: string, uid: number, gid: number) => {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/ssh/file_manager/ssh/changeOwnership`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: "linux", path, uid, gid }),
          signal: AbortSignal.timeout(20000),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    const target = f.root + "/中文 ' $(touch OWNERSHIP_INJECTED)\n",
      link = f.root + "/链接%2F\n";
    await f.write(target, "unchanged bytes");
    await new Promise<void>((resolve, reject) =>
      f.sftp.symlink(target, link, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    for (const gid of [1600, 1000]) {
      const result = await change(target, 1000, gid);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ success: true, uid: 1000, gid });
      expect(await f.io.stat(target)).toMatchObject({ uid: 1000, gid });
    }
    expect((await change(link, 1000, 1600)).status).toBe(200);
    expect(await f.io.stat(link)).toMatchObject({
      kind: "symlink",
      uid: 1000,
      gid: 1600,
    });
    expect(await f.io.stat(target)).toMatchObject({ uid: 1000, gid: 1000 });
    for (const [uid, gid] of [
      [0, 1000],
      [1000, 0],
    ]) {
      expect((await change(target, uid, gid)).status).toBe(500);
      expect(await f.io.stat(target)).toMatchObject({ uid: 1000, gid: 1000 });
    }
    expect((await f.read(target)).toString()).toBe("unchanged bytes");
    expect(await f.exists("/home/alpine/OWNERSHIP_INJECTED")).toBe(false);
  },
  45000,
);
