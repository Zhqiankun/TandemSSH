import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  CommandFrameDecoder,
  frameCommand,
  PtyCommandExecutor,
  quoteShellWord,
  type PtyCommandResult,
} from "../../collaboration/adapters/pty-command.js";

const token = "a".repeat(32);
const begin = `\x1b]633;Tandem;${token};begin\x07`;
const end = (code: number, cwd: string) =>
  `\x1b]633;Tandem;${token};end;${code};${Buffer.from(cwd).toString("base64")}\x07`;

describe("PTY command protocol", () => {
  it("handles split UTF-8 and marker boundaries without including command echo", () => {
    let result: PtyCommandResult | undefined;
    const decoder = new CommandFrameDecoder(token, (value) => {
      result = value;
    });
    const bytes = Buffer.from(
      "echoed helper" +
        begin +
        "中文输出\r\n" +
        end(7, "/srv/有 空格") +
        "prompt",
    );
    for (const byte of bytes) decoder.feed(Buffer.from([byte]));
    expect(result).toEqual({
      exitCode: 7,
      cwd: "/srv/有 空格",
      output: "中文输出\r\n",
      truncated: false,
    });
  });

  it("bounds output while retaining the completion marker", () => {
    let result: PtyCommandResult | undefined;
    const decoder = new CommandFrameDecoder(
      token,
      (value) => {
        result = value;
      },
      10,
    );
    decoder.feed(begin + "x".repeat(10000) + end(0, "/"));
    expect(result).toMatchObject({
      exitCode: 0,
      output: "xxxxxxxxxx",
      truncated: true,
    });
  });

  it("marks broken streams and invalid result metadata unknown", () => {
    const results: PtyCommandResult[] = [];
    const decoder = new CommandFrameDecoder(token, (value) =>
      results.push(value),
    );
    decoder.feed(begin + "partial");
    decoder.unknown();
    decoder.unknown();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ exitCode: null, output: "partial" });
    const invalid = new CommandFrameDecoder(token, (value) =>
      results.push(value),
    );
    invalid.feed(begin + `\x1b]633;Tandem;${token};end;0;invalid\x07`);
    expect(results[1].exitCode).toBeNull();
  });

  it("quotes shell metacharacters and refuses terminal control characters", () => {
    expect(quoteShellWord("a'b;$(bad)")).toBe("'a'\\''b;$(bad)'");
    expect(() => quoteShellWord("a\rb")).toThrow(
      "UNSUPPORTED_TERMINAL_CONTROL_CHARACTER",
    );
    expect(() => quoteShellWord("a\nb")).toThrow(
      "UNSUPPORTED_TERMINAL_CONTROL_CHARACTER",
    );
    const packet = Buffer.from(
      frameCommand(
        {
          type: "terminal.command",
          program: "printf",
          args: ["%s", "$(touch bad);你好"],
          cwd: "/tmp",
        },
        token,
      ),
    ).toString();
    expect(packet).toContain("'$(touch bad);你好'");
    expect(packet).not.toContain("eval");
  });

  it("does not begin a timeout during slow approval/audit preparation", async () => {
    const stream = new EventEmitter();
    const executor = new PtyCommandExecutor(() => stream, 10);
    const prepared = await executor.prepare(
      { type: "terminal.command", program: "pwd", args: [], cwd: "/" },
      "operation",
    );
    let finished = false;
    void prepared.completion.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(finished).toBe(false);
    prepared.beforeSend?.();
    expect((await prepared.completion).exitCode).toBeNull();
    prepared.dispose();
    expect(stream.listenerCount("data")).toBe(0);
  });
});

describe("known delayed ConPTY input echo", () => {
  it("removes only the exact delayed input suffix and its line ending", () => {
    const input = Buffer.from(
      frameCommand(
        {
          type: "terminal.command",
          program: "printf",
          args: ["%s", "line\nvalue"],
          cwd: "/srv",
        },
        token,
      ),
    )
      .toString()
      .replace(/\r$/, "");
    let result: unknown;
    const decoder = new CommandFrameDecoder(
      token,
      (value) => {
        result = value;
      },
      256000,
      input,
    );
    const split = input.length - 23;
    const output =
      input.slice(0, split) +
      "\x1b[?2004l" +
      begin +
      input.slice(split) +
      "\r\nactual\noutput" +
      end(0, "/srv");
    for (const char of output) decoder.feed(char);
    expect(result).toMatchObject({ exitCode: 0, output: "actual\noutput" });
  });
  it("preserves genuine leading output when the echoed line ending already arrived", () => {
    const input = Buffer.from(
      frameCommand(
        {
          type: "terminal.command",
          program: "printf",
          args: ["%s", "x"],
          cwd: "/srv",
        },
        token,
      ),
    )
      .toString()
      .replace(/\r$/, "");
    let result: unknown;
    const decoder = new CommandFrameDecoder(
      token,
      (value) => {
        result = value;
      },
      256000,
      input,
    );
    decoder.feed(input + "\r\n" + begin + "\nreal blank line" + end(0, "/srv"));
    expect(result).toMatchObject({ output: "\nreal blank line" });
  });
  it("does not discard output that differs from the possible echo suffix", () => {
    const input = Buffer.from(
      frameCommand(
        { type: "terminal.command", program: "pwd", args: [], cwd: "/srv" },
        token,
      ),
    )
      .toString()
      .replace(/\r$/, "");
    let result: unknown;
    const decoder = new CommandFrameDecoder(
      token,
      (value) => {
        result = value;
      },
      256000,
      input,
    );
    decoder.feed(
      input.slice(0, -10) + begin + "different output\n" + end(0, "/srv"),
    );
    expect(result).toMatchObject({ output: "different output\n" });
  });
});

describe("damaged terminal frame handling", () => {
  it("rejects a matching end before begin across packet splits without claiming success", () => {
    const results: PtyCommandResult[] = [];
    const decoder = new CommandFrameDecoder(token, (r) => results.push(r));
    for (const byte of Buffer.from(
      "bash: ommand: command not found\r\n" + end(0, "/srv"),
    ))
      decoder.feed(Buffer.of(byte));
    expect(results).toEqual([
      {
        exitCode: null,
        cwd: undefined,
        output: "",
        truncated: false,
        protocolError: true,
      },
    ]);
    decoder.feed(begin + end(0, "/"));
    expect(results).toHaveLength(1);
  });
  it("ignores another operation's marker and still accepts its own complete frame", () => {
    let result: PtyCommandResult | undefined;
    const decoder = new CommandFrameDecoder(token, (r) => (result = r));
    decoder.feed(end(0, "/wrong").replaceAll(token, "b".repeat(32)));
    expect(result).toBeUndefined();
    decoder.feed(begin + "verified" + end(0, "/srv"));
    expect(result).toMatchObject({
      exitCode: 0,
      output: "verified",
      cwd: "/srv",
    });
    expect(result?.protocolError).toBeUndefined();
  });
  it("bounds context verification independently of a long command timeout", async () => {
    vi.useFakeTimers();
    try {
      const stream = new EventEmitter(),
        executor = new PtyCommandExecutor(() => stream, 120000),
        probe = executor.prepareContext();
      let done = false;
      void probe.completion.then(() => {
        done = true;
      });
      probe.beforeSend?.();
      await vi.advanceTimersByTimeAsync(14999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await probe.completion).toMatchObject({
        exitCode: null,
        timedOut: true,
      });
      expect(stream.listenerCount("data")).toBe(0);
      probe.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  const shell =
    process.env.TANDEM_TEST_BASH ??
    (process.platform === "win32" ? "" : "/bin/bash");
  it.skipIf(!shell)(
    "does not execute the requested side effect when the frame's first command is damaged",
    () => {
      const base = fs.realpathSync(path.resolve(process.cwd(), "../.cache")),
        folder = fs.mkdtempSync(path.join(base, "damaged-frame-")),
        file = path.join(folder, "side-effect");
      const posix = (p: string) =>
        process.platform === "win32"
          ? p
              .replace(/\\/g, "/")
              .replace(/^([A-Za-z]):/, (_, d: string) => "/" + d.toLowerCase())
          : p;
      try {
        const line = Buffer.from(
          frameCommand(
            {
              type: "terminal.command",
              program: "touch",
              args: [posix(file)],
              cwd: posix(folder),
            },
            token,
          ),
        )
          .toString()
          .replace(/\r$/, "");
        for (const broken of [
          line.slice(1),
          line.replace("if command printf", "if __tandem_missing_printf"),
        ]) {
          const result = spawnSync(
            shell,
            ["--noprofile", "--norc", "-c", broken],
            {
              cwd: folder,
              encoding: "utf8",
              windowsHide: true,
              timeout: 10000,
            },
          );
          expect(result.error).toBeUndefined();
          expect(fs.existsSync(file)).toBe(false);
        }
        const good = spawnSync(shell, ["--noprofile", "--norc", "-c", line], {
          cwd: folder,
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
        });
        expect(good.status, good.stderr).toBe(0);
        expect(fs.existsSync(file)).toBe(true);
      } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(folder);
      }
    },
  );
});
