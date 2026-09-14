import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import type { Client } from "ssh2";
import { describe, expect, it } from "vitest";
import {
  detectTmux,
  execCommand,
  tmuxCommand,
  withTmuxPath,
} from "../../../hosts/tmux/helper.js";

describe("tmux command path handling", () => {
  it("prepends all non-login tmux paths while preserving inherited PATH", () => {
    expect(withTmuxPath("command -v tmux")).toBe(
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; command -v tmux'`,
    );
  });

  it("shell-escapes embedded single quotes in wrapped commands", () => {
    // Asserted as a string so the escaping rule is covered everywhere. The
    // round-trip below proves it against a real parser, but only where one
    // exists -- see the note there.
    expect(withTmuxPath(`printf '%s' "can't"`)).toBe(
      "/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:\"$PATH\"; export PATH; printf '\\''%s'\\'' \"can'\\''t\"'",
    );
  });

  // /bin/sh is not on Windows, and Windows is a supported platform for the
  // desktop app -- contributors run `npm test` there. CI is ubuntu-only, so it
  // would never notice this failing.
  it.skipIf(process.platform === "win32")(
    "produces a command a real shell parses back to the original",
    () => {
      const command = withTmuxPath(`printf '%s' "can't"`);

      expect(
        execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" }),
      ).toBe("can't");
    },
  );

  it("runs every tmux invocation in UTF-8 mode through the path wrapper", () => {
    expect(tmuxCommand("list-sessions")).toBe(
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u list-sessions'`,
    );
  });

  it("detects tmux with the UTF-8 wrapper", async () => {
    const commands: string[] = [];
    const conn = {
      exec(command: string, callback: (error: null, stream: never) => void) {
        commands.push(command);
        const stream = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
        };
        stream.stderr = new EventEmitter();
        callback(null, stream as never);

        queueMicrotask(() => {
          if (commands.length === 1) {
            stream.emit("data", Buffer.from("tmux 3.7b\n"));
            stream.emit("close", 0);
            return;
          }
          stream.emit("close", 1);
        });
      },
    } as unknown as Client;

    await expect(detectTmux(conn)).resolves.toEqual({
      available: true,
      sessions: [],
    });
    expect(commands).toEqual([
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u -V'`,
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u list-sessions -F "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}|#{session_attached}" 2>/dev/null'`,
    ]);
  });
});

function fragmentedClient(stdout: string, stderr = "", exitCode = 0): Client {
  return {
    exec(_command: string, callback: (error: null, stream: never) => void) {
      const stream = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
      };
      stream.stderr = new EventEmitter();
      callback(null, stream as never);
      queueMicrotask(() => {
        const out = Buffer.from(stdout);
        const err = Buffer.from(stderr);
        for (let i = 0; i < Math.max(out.length, err.length); i++) {
          if (i < out.length) stream.emit("data", out.subarray(i, i + 1));
          if (i < err.length)
            stream.stderr.emit("data", err.subarray(i, i + 1));
        }
        stream.emit("close", exitCode);
      });
    },
  } as unknown as Client;
}

describe("tmux UTF-8 packet boundaries", () => {
  it("preserves a multibyte session name in the parsed session list", async () => {
    const result = await detectTmux(fragmentedClient("部署😀|1|2|3|4\n"));
    expect(result).toEqual({
      available: true,
      sessions: [
        {
          name: "部署😀",
          created: 1,
          lastActivity: 2,
          windows: 3,
          attachedClients: 4,
        },
      ],
    });
  });
  it("decodes interleaved stdout and stderr independently", async () => {
    await expect(
      execCommand(fragmentedClient("输出😀\n", "警告繁體\n"), "fixture"),
    ).resolves.toBe("输出😀");
  });
  it("preserves a fragmented remote error", async () => {
    await expect(
      execCommand(fragmentedClient("", "找不到会话😀\n", 1), "fixture"),
    ).rejects.toThrow("找不到会话😀");
  });
});
