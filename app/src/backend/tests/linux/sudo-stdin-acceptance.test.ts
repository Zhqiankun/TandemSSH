import { expect, it } from "vitest";
import {
  linuxFixture,
  linuxManifest,
} from "../../test-helpers/linux-ssh-fixture.js";
import {
  ChannelOpenSerializer,
  execWithSudoBuffer,
  type SSHSession,
} from "../../hosts/file-manager/session.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";

it.runIf(
  !!process.env.TANDEM_LINUX_MANIFEST && process.env.TANDEM_LINUX_SUDO === "1",
)(
  "authenticates sudo through real SSH stdin and deletes only after explicit elevation",
  async () => {
    const f = await linuxFixture();
    const manifest = linuxManifest();
    const sent: string[] = [];
    const session: SSHSession = {
      client: new Proxy(f.client, {
        get(real, key) {
          if (key === "exec")
            return (
              command: string,
              callback: Parameters<typeof real.exec>[1],
            ) => {
              sent.push(command);
              return real.exec(command, callback);
            };
          const value = Reflect.get(real, key);
          return typeof value === "function" ? value.bind(real) : value;
        },
      }),
      channelOpener: new ChannelOpenSerializer(),
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
    };
    const protectedDir = f.root + "/protected";
    const file = protectedDir + "/root-owned";
    let directoryCreated = false;
    try {
      expect((await f.exec("command -v sudo")).code).toBe(0);
      expect((await f.exec("sudo -k")).code).toBe(0);
      expect((await f.exec("sudo -n true")).code).not.toBe(0);
      const rejected = await execWithSudoBuffer(
        session,
        "id -u",
        "wrong-fixture-password",
      );
      expect(rejected.code).not.toBe(0);
      const identity = await execWithSudoBuffer(
        session,
        "id -u",
        manifest.password,
      );
      expect(identity.code).toBe(0);
      expect(identity.stdout.toString().trim()).toBe("0");
      expect(
        (
          await execWithSudoBuffer(
            session,
            "mkdir -m 755 -- " + quoteShellWord(protectedDir),
            manifest.password,
          )
        ).code,
      ).toBe(0);
      directoryCreated = true;
      expect(
        (
          await execWithSudoBuffer(
            session,
            "touch -- " + quoteShellWord(file),
            manifest.password,
          )
        ).code,
      ).toBe(0);
      expect((await f.exec("rm -f -- " + quoteShellWord(file))).code).not.toBe(
        0,
      );
      expect(await f.exists(file)).toBe(true);
      expect(
        (
          await execWithSudoBuffer(
            session,
            "rm -f -- " + quoteShellWord(file),
            manifest.password,
          )
        ).code,
      ).toBe(0);
      expect(await f.exists(file)).toBe(false);
      expect(sent.length).toBeGreaterThan(4);
      expect(
        sent.every(
          (command) =>
            !command.includes(manifest.password) &&
            !command.includes("wrong-fixture-password"),
        ),
      ).toBe(true);
    } finally {
      if (directoryCreated) {
        await execWithSudoBuffer(
          session,
          "rm -f -- " + quoteShellWord(file),
          manifest.password,
        );
        await execWithSudoBuffer(
          session,
          "rmdir -- " + quoteShellWord(protectedDir),
          manifest.password,
        );
      }
      await f.close();
    }
  },
  120000,
);
