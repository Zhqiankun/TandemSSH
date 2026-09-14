import { describe, expect, it } from "vitest";
import { resolveSshKeepalive } from "./ssh-keepalive.js";

describe("resolveSshKeepalive", () => {
  it("preserves zero to disable SSH keepalives", () => {
    expect(resolveSshKeepalive(0, 0, 30000, 5)).toEqual({
      keepaliveInterval: 0,
      keepaliveCountMax: 0,
    });
  });

  it("uses defaults when keepalive settings are absent", () => {
    expect(resolveSshKeepalive(undefined, undefined, 60000, 5)).toEqual({
      keepaliveInterval: 60000,
      keepaliveCountMax: 5,
    });
  });

  it("enforces the existing minimums for positive settings", () => {
    expect(resolveSshKeepalive(1, 0.5, 30000, 5)).toEqual({
      keepaliveInterval: 5000,
      keepaliveCountMax: 1,
    });
  });
});

it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, 2147484])(
  "does not pass an invalid or overflowing interval %s to a timer",
  (interval) => {
    expect(resolveSshKeepalive(interval, 3, 30000, 5).keepaliveInterval).toBe(
      30000,
    );
  },
);
it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])(
  "uses the configured count default for unsafe %s",
  (count) => {
    expect(resolveSshKeepalive(30, count, 30000, 5).keepaliveCountMax).toBe(5);
  },
);
it("uses integer heartbeat counts and keeps a timer-safe boundary", () => {
  expect(resolveSshKeepalive(2147483, 2.9, 30000, 5)).toEqual({
    keepaliveInterval: 2147483000,
    keepaliveCountMax: 2,
  });
});
