import { describe, expect, it } from "vitest";
import { frameCommand } from "../../../collaboration/adapters/pty-command.js";
import { InternalCommandOutputFilter } from "../../../hosts/terminal/internal-command-output.js";

const token = "a".repeat(32);
const begin = `\x1b]633;Tandem;${token};begin\x07`;
const end = (code = 0, cwd = "/srv") =>
  `\x1b]633;Tandem;${token};end;${code};${Buffer.from(cwd).toString("base64")}\x07`;

function echoFor(action: Parameters<typeof frameCommand>[0]): string {
  return Buffer.from(frameCommand(action, token))
    .toString("utf8")
    .replace(/\r$/, "");
}

describe("internal PTY command display", () => {
  it("hides the cwd probe wrapper and its private protocol frames", () => {
    const filter = new InternalCommandOutputFilter();
    const expectedEcho = echoFor(null);
    filter.arm({ token, expectedEcho });

    const visible = filter.feed(
      expectedEcho + "\r\n" + begin + end() + "owner@host:/srv$ ",
    );

    expect(visible).toBe("\r\x1b[2Kowner@host:/srv$ ");
    expect(visible).not.toContain("__tandem_");
    expect(visible).not.toContain("633;Tandem");
  });

  it("replaces a framed automation line with the short real command", () => {
    const action = {
      type: "terminal.command" as const,
      program: "docker",
      args: ["ps", "--format", "{{.Names}}"],
      cwd: "/srv",
    };
    const filter = new InternalCommandOutputFilter();
    const expectedEcho = echoFor(action);
    filter.arm({
      token,
      expectedEcho,
      visibleCommand: "docker ps --format '{{.Names}}'",
    });

    const raw =
      expectedEcho +
      "\r\n" +
      begin +
      "api\r\ndatabase\r\n" +
      end() +
      "owner@host:/srv$ ";
    let visible = "";
    for (let index = 0; index < raw.length; index += 7)
      visible += filter.feed(raw.slice(index, index + 7));

    expect(visible).toBe(
      "docker ps --format '{{.Names}}'\r\n" +
        "api\r\ndatabase\r\nowner@host:/srv$ ",
    );
  });

  it("preserves command output when the remote PTY does not echo input", () => {
    const filter = new InternalCommandOutputFilter();
    filter.arm({
      token,
      expectedEcho: echoFor(null),
      visibleCommand: "uptime",
    });

    expect(filter.feed(begin + "up 3 days\r\n" + end())).toBe(
      "uptime\r\nup 3 days\r\n",
    );
  });

  it("fails open for unrelated output and releases only the matching frame", () => {
    const filter = new InternalCommandOutputFilter();
    filter.arm({ token, expectedEcho: echoFor(null) });
    expect(filter.release("b".repeat(32))).toBe("");
    expect(filter.feed("background service message\r\n")).toBe("");
    expect(filter.release(token)).toBe("background service message\r\n");
    expect(filter.feed("manual output")).toBe("manual output");
  });
});

it("keeps real remote diagnostics when a private frame never begins", () => {
  const filter = new InternalCommandOutputFilter();
  const expectedEcho = echoFor(null);
  filter.arm({ token, expectedEcho });
  expect(filter.feed(expectedEcho + "\r\nsh: printf: not found\r\n")).toBe("");
  expect(filter.release(token)).toBe("\r\x1b[2Ksh: printf: not found\r\n");
});
