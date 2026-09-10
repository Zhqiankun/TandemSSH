import type { Express, RequestHandler } from "express";
import { afterEach, expect, it, vi } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";
import { registerFileActionRoutes } from "../../hosts/file-manager/action-routes.js";
import type { SSHSession } from "../../hosts/file-manager/session.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "roundtrips special Unix permissions through the real route and OpenSSH",
  async () => {
    const f = await linuxFixture();
    closers.push(() => f.close());
    const handlers = new Map<string, RequestHandler>();
    const app = {
      post: (name: string, handler: RequestHandler) =>
        handlers.set(name, handler),
    } as unknown as Express;
    registerFileActionRoutes(app, {
      sshSessions: {
        linux: {
          client: f.client,
          isConnected: true,
          channelOpener: { run: <T>(fn: () => Promise<T>) => fn() },
        } as SSHSession,
      },
      scheduleSessionCleanup: vi.fn(),
      verifySessionOwnership: (_session, user) => user === "fixture-owner",
    });
    const change = (path: string, permissions: string) =>
      new Promise<{ status: number; body: { success?: boolean } }>(
        (resolve, reject) => {
          let status = 200;
          const res = {
            headersSent: false,
            status(code: number) {
              status = code;
              return this;
            },
            json(body: { success?: boolean }) {
              this.headersSent = true;
              resolve({ status, body });
            },
          };
          Promise.resolve(
            handlers.get("/ssh/file_manager/ssh/changePermissions")!(
              {
                userId: "fixture-owner",
                body: { sessionId: "linux", path, permissions },
              } as never,
              res as never,
              reject,
            ),
          ).catch(reject);
        },
      );
    const directory = f.root + "/共享 ' $(touch SHOULD_NOT_EXIST)",
      file = f.root + "/-配置.txt";
    expect(
      (
        await f.exec(
          `mkdir ${quoteShellWord(directory)} && touch ${quoteShellWord(file)}`,
        )
      ).code,
    ).toBe(0);
    for (const [target, modes] of [
      [directory, ["1777", "2755", "0755", "0700"]],
      [file, ["4755", "2750", "0644"]],
    ] as const) {
      for (const mode of modes) {
        expect(await change(target, mode)).toEqual({
          status: 200,
          body: { success: true, message: "Permissions changed successfully" },
        });
        const stat = await f.io.stat(target);
        expect((stat.mode & 0o7777).toString(8).padStart(4, "0")).toBe(mode);
      }
    }
    expect(await f.exists(f.root + "/SHOULD_NOT_EXIST")).toBe(false);
    expect(await f.exists("/home/alpine/SHOULD_NOT_EXIST")).toBe(false);
    expect((await change(file, "888")).status).toBe(400);
    expect(((await f.io.stat(file)).mode & 0o7777).toString(8)).toBe("644");
    expect((await change(f.root + "/missing", "0644")).status).toBe(500);
  },
  45000,
);
