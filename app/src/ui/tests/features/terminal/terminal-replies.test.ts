import { afterEach, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { installTerminalReplies } from "@/features/terminal/terminal-replies";
import { TerminalReplyRequests } from "../../../../backend/collaboration/sessions/terminal-replies.js";
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true }),
    replies = installTerminalReplies(terminal),
    events: Array<{ data: string; reply?: { replay: boolean } }> = [];
  const listener = terminal.onData((data) =>
    events.push({ data, reply: replies.consume(data) }),
  );
  cleanup.push(
    () => terminal.dispose(),
    () => replies.dispose(),
    () => listener.dispose(),
  );
  const write = (data: string) =>
    new Promise<void>((resolve) => terminal.write(data, resolve));
  return { terminal, replies, events, write };
}
it("recognizes actual xterm cursor/status/device replies without reclassifying later user keys", async () => {
  const f = fixture(),
    queries = ["\x1b[6n", "\x1b[?6n", "\x1b[5n", "\x1b[c", "\x1b[>0c"];
  for (const query of queries) {
    const ledger = new TerminalReplyRequests();
    ledger.observe(query);
    await f.write(query);
    const last = f.events.at(-1)!;
    expect(last.reply).toEqual({ replay: false });
    expect(ledger.consume(last.data)).toBe(true);
  }
  f.terminal.input("\x1b[1;2R", true);
  expect(f.events.at(-1)?.reply).toBeUndefined();
});
it("marks replies produced by history replay for suppression", async () => {
  const f = fixture(),
    end = f.replies.beginReplay();
  await f.write("\x1b[6n");
  expect(f.events.at(-1)?.reply).toEqual({ replay: true });
  end();
  await f.write("\x1b[6n");
  expect(f.events.at(-1)?.reply).toEqual({ replay: false });
});
it("agrees with the renderer about cancelled control strings and split queries", async () => {
  const f = fixture(),
    ledger = new TerminalReplyRequests();
  for (const data of [
    "\x1b]0;title [6n\x07",
    "\x1bP1ztext [6n\x1b\\",
    "\x1b]0;cancelled\x1b[",
    "6n",
  ]) {
    ledger.observe(data);
    await f.write(data);
  }
  expect(f.events).toHaveLength(1);
  expect(ledger.consume(f.events[0].data)).toBe(true);
});
