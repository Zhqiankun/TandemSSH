import { afterEach, expect, it, vi } from "vitest";
import { KeyboardInteractiveExchange } from "../../hosts/keyboard-interactive.js";
import type { SSHInteractiveChallenge } from "../../../types/ssh-interactive-auth.js";
const close: KeyboardInteractiveExchange[] = [];
afterEach(() => {
  for (const exchange of close.splice(0)) exchange.dispose();
  vi.useRealTimers();
});
function fixture(options = {}) {
  const challenges: SSHInteractiveChallenge[] = [],
    failure = vi.fn();
  const exchange = new KeyboardInteractiveExchange({
    challenge: (value) => challenges.push(value),
    failure,
    ...options,
  });
  close.push(exchange);
  return { exchange, challenges, failure };
}
it("keeps stored passwords private and maps every visible answer back to the original SSH order", () => {
  const f = fixture(),
    finish = vi.fn();
  f.exchange.begin(
    "login",
    "instructions",
    [
      { prompt: "Password:", echo: false },
      { prompt: "Tenant:", echo: true },
      { prompt: "Code:", echo: false },
    ],
    finish,
    "stored fixture password",
  );
  const challenge = f.challenges[0];
  expect(challenge.prompts.map((p) => p.index)).toEqual([1, 2]);
  expect(JSON.stringify(challenge)).not.toContain("stored fixture password");
  f.exchange.respond(challenge.id, ["  租户  ", ""]);
  expect(finish).toHaveBeenCalledWith([
    "stored fixture password",
    "  租户  ",
    "",
  ]);
});
it("rejects unknown IDs, duplicate answers and old rounds without calling finish again", () => {
  const f = fixture(),
    first = vi.fn(),
    second = vi.fn();
  f.exchange.begin("", "", [{ prompt: "One:", echo: true }], first);
  const one = f.challenges[0].id;
  expect(() => f.exchange.respond("wrong", ["bad"])).toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  f.exchange.respond(one, ["a"]);
  expect(() => f.exchange.respond(one, ["again"])).toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  f.exchange.begin("", "", [{ prompt: "Two:", echo: false }], second);
  expect(() => f.exchange.respond(one, ["old"])).toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  f.exchange.respond(f.challenges[1].id, ["b"]);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledWith(["b"]);
});
it("clears the old round before a synchronous next-round callback", () => {
  const f = fixture(),
    last = vi.fn();
  f.exchange.begin("", "", [{ prompt: "One:", echo: true }], () =>
    f.exchange.begin("", "", [{ prompt: "Two:", echo: false }], last),
  );
  f.exchange.respond(f.challenges[0].id, ["a"]);
  f.exchange.respond(f.challenges[1].id, ["b"]);
  expect(last).toHaveBeenCalledWith(["b"]);
});
it("accepts zero prompts and validates response count and bounded UTF-8 bytes without trimming", () => {
  const f = fixture(),
    empty = vi.fn(),
    finish = vi.fn();
  f.exchange.begin("", "", [], empty);
  expect(empty).toHaveBeenCalledWith([]);
  expect(f.challenges).toEqual([]);
  f.exchange.begin("", "", [{ prompt: "Text:", echo: true }], finish);
  const id = f.challenges[0].id;
  for (const answer of [
    [],
    [123],
    ["x", "y"],
    ["汉".repeat(6000)],
    ["x".repeat(20000)],
  ])
    expect(() => f.exchange.respond(id, answer)).toThrow(
      "SSH_AUTH_INVALID_RESPONSE",
    );
  expect(finish).not.toHaveBeenCalled();
  f.exchange.respond(id, ["\t text \n"]);
  expect(finish).toHaveBeenCalledWith(["\t text \n"]);
});
it("expires pending prompts and also bounds waiting after a valid response", () => {
  vi.useFakeTimers();
  const f = fixture({ timeoutMs: 100, lifetimeMs: 300 }),
    finish = vi.fn();
  f.exchange.begin("", "", [{ prompt: "Text:", echo: true }], finish);
  const id = f.challenges[0].id;
  vi.advanceTimersByTime(100);
  expect(f.failure).toHaveBeenCalledWith("SSH_AUTH_TIMEOUT", id);
  expect(() => f.exchange.respond(id, ["late"])).toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  expect(finish).not.toHaveBeenCalled();
  const g = fixture({ timeoutMs: 100, lifetimeMs: 300 });
  g.exchange.begin("", "", [{ prompt: "Text:", echo: true }], vi.fn());
  g.exchange.respond(g.challenges[0].id, ["accepted"]);
  vi.advanceTimersByTime(299);
  expect(g.failure).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(g.failure).toHaveBeenCalledWith("SSH_AUTH_TIMEOUT", undefined);
});
it("cancellation and disposal refuse late input and do not send empty answers", () => {
  const f = fixture(),
    finish = vi.fn();
  f.exchange.begin("", "", [{ prompt: "Text:", echo: true }], finish);
  const id = f.challenges[0].id;
  expect(f.exchange.cancel("old")).toBe(false);
  expect(f.exchange.cancel(id)).toBe(true);
  expect(f.failure).toHaveBeenCalledWith("SSH_AUTH_CANCELLED", id);
  expect(finish).not.toHaveBeenCalled();
  expect(() => f.exchange.respond(id, [""])).toThrow("SSH_AUTH_STALE_PROMPT");
  const g = fixture();
  g.exchange.begin("", "", [{ prompt: "Text:", echo: true }], finish);
  g.exchange.dispose();
  expect(() => g.exchange.respond(g.challenges[0].id, ["late"])).toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  expect(g.failure).not.toHaveBeenCalled();
});
it("bounds malformed challenges and automatic rounds, and tolerates a closed notification transport", () => {
  const f = fixture();
  f.exchange.begin(
    "",
    "",
    Array.from({ length: 17 }, () => ({ prompt: "p", echo: false })),
    vi.fn(),
  );
  expect(f.failure).toHaveBeenCalledWith(
    "SSH_AUTH_INVALID_CHALLENGE",
    undefined,
  );
  const g = fixture(),
    finish = vi.fn();
  for (let i = 0; i < 33; i++) g.exchange.begin("", "", [], finish);
  expect(finish).toHaveBeenCalledTimes(32);
  expect(g.failure).toHaveBeenCalledWith("SSH_AUTH_LIMIT", undefined);
  const h = fixture({
    failure: () => {
      throw Error("socket closed");
    },
  });
  h.exchange.begin("", "", [{ prompt: "p", echo: false }], vi.fn());
  expect(() => h.exchange.cancel(h.challenges[0].id)).not.toThrow();
});
