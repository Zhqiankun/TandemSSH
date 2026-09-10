import { describe, it, expect } from "vitest";
import { TerminalReplyRequests } from "../../collaboration/sessions/terminal-replies.js";
import { matchesTerminalReply } from "../../../types/terminal-replies.js";
describe("bounded terminal reply requests", () => {
  it.each([
    ["\x1b[6n", "\x1b[24;17R"],
    ["\x1b[?6n", "\x1b[?2;3R"],
    ["\x1b[5n", "\x1b[0n"],
    ["\x1b[c", "\x1b[?1;2c"],
    ["\x1b[>0c", "\x1b[>0;276;0c"],
  ])("matches one reply for query %j", (query, reply) => {
    for (let split = 1; split < query.length; split++) {
      const r = new TerminalReplyRequests();
      r.observe(query.slice(0, split));
      expect(r.consume(reply)).toBe(false);
      r.observe(query.slice(split));
      expect(r.consume(reply)).toBe(true);
      expect(r.consume(reply)).toBe(false);
    }
  });
  it("does not accept commands or replies without a matching query", () => {
    const r = new TerminalReplyRequests();
    expect(r.consume("\x1b[1;1R")).toBe(false);
    r.observe("\x1b[6n");
    expect(r.consume("touch arbitrary\r")).toBe(false);
    expect(r.consume("\x1b[1;1R\r")).toBe(false);
    expect(r.consume("\x1b[?1;1R")).toBe(false);
    expect(r.consume("\x1b[1;1R")).toBe(true);
  });
  it("ignores literal query-like text in strings and follows VT escape cancellation", () => {
    const r = new TerminalReplyRequests();
    r.observe("\x1b]0;title [6n\x07\x1bP1$qpayload [6n\x1b\\");
    expect(r.consume("\x1b[1;1R")).toBe(false);
    r.observe("\x1b]0;title\x1b[6n");
    expect(r.consume("\x1b[1;1R")).toBe(true);
  });
  it("expires and clears requests with a bounded queue", () => {
    let now = 100;
    const r = new TerminalReplyRequests(() => now);
    r.observe("\x1b[6n".repeat(100));
    let accepted = 0;
    while (r.consume("\x1b[1;1R")) accepted++;
    expect(accepted).toBe(64);
    r.observe("\x1b[6n");
    now += 10001;
    expect(r.consume("\x1b[1;1R")).toBe(false);
    r.observe("\x1b[6n");
    r.clear();
    expect(r.consume("\x1b[1;1R")).toBe(false);
  });
  it("rejects zero positions, excessive numeric fields and non-ASCII payloads", () => {
    expect(matchesTerminalReply("cursor", "\x1b[0;1R")).toBe(false);
    expect(matchesTerminalReply("cursor", "\x1b[99999;1R")).toBe(false);
    expect(matchesTerminalReply("primary-attributes", "\x1b[?1;evilc")).toBe(
      false,
    );
    expect(matchesTerminalReply("status", "\x1b[0n extra")).toBe(false);
  });
});
