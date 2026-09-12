import { expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";
import { readTerminalDirectory } from "../../hosts/terminal/working-directory.js";

it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "reads the actual interactive shell directory after manual cd and rejects stale input",
  async () => {
    const f = await linuxFixture();
    try {
      const terminal = await f.terminal();
      const read = () =>
        readTerminalDirectory(
          terminal.control,
          () => terminal.executor.prepareContext(),
          () => !terminal.stream.destroyed,
          true,
        );
      terminal.control.humanInput(
        Buffer.from("cd -- " + quoteShellWord(f.child) + "\r"),
      );
      expect(await read()).toBe(f.child);
      const independent = await f.exec("pwd");
      expect(independent.code).toBe(0);
      expect(independent.output.trim()).not.toBe(f.child);
      terminal.control.grant(
        { ownerType: "agent-task", ownerId: "fixture-ai" },
        terminal.control.snapshot(),
      );
      const revision = terminal.control.humanInputRevision();
      await expect(read()).rejects.toThrow("CWD_CONTROL_BUSY");
      expect(terminal.control.humanInputRevision()).toBe(revision);
      expect(terminal.control.snapshot().controller.kind).toBe("automation");
      terminal.control.takeover();
      const pending = read();
      terminal.control.humanInput(
        Buffer.from("cd -- " + quoteShellWord(f.root) + "\r"),
      );
      await expect(pending).rejects.toThrow("CWD_CHANGED");
      expect(await read()).toBe(f.root);
    } finally {
      await f.close();
    }
  },
  60000,
);
