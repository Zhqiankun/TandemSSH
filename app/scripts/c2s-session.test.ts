import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url),
  { C2sSession } = require("./../electron/c2s-session.cjs");
function fixture() {
  const root = path.resolve("fixture-app"),
    frame = { url: pathToFileURL(path.join(root, "dist/index.html")).href },
    sender = { mainFrame: frame },
    window = { webContents: sender, isDestroyed: () => false },
    changed = vi.fn(),
    context = new C2sSession({
      getWindow: () => window,
      appRoot: root,
      isDev: false,
      onChange: changed,
    });
  return { context, event: { sender, senderFrame: frame }, changed };
}
const tunnel = {
  relayOrigin: "local",
  sourceHostId: 7,
  sourceIdentity: { ip: "127.0.0.1", port: 22, username: "fixture" },
};
it("uses only the fixed embedded relay and never persists its token in tunnel data", () => {
  const f = fixture();
  f.context.set(f.event, "local-token");
  const bound = f.context.bind(tunnel);
  expect(f.context.url).toBe("ws://127.0.0.1:30003/ssh/tunnel/c2s/stream");
  expect(f.context.headers(bound)).toMatchObject({
    Authorization: "Bearer local-token",
  });
  expect(JSON.stringify(bound)).not.toContain("local-token");
});
it("rejects legacy numeric-only configurations and unauthenticated starts", () => {
  const f = fixture();
  expect(() => f.context.bind(tunnel)).toThrow("C2S_AUTH_REQUIRED");
  f.context.set(f.event, "local-token");
  expect(() => f.context.bind({ sourceHostId: 7 })).toThrow(
    "C2S_REVIEW_REQUIRED",
  );
  expect(() => f.context.bind({ ...tunnel, relayOrigin: "remote" })).toThrow(
    "C2S_REVIEW_REQUIRED",
  );
});
it("revokes old request epochs on login changes and clears headers on logout", () => {
  const f = fixture();
  f.context.set(f.event, "first");
  const old = f.context.bind(tunnel);
  const count = f.changed.mock.calls.length;
  f.context.set(f.event, "first");
  expect(f.changed).toHaveBeenCalledTimes(count);
  f.context.set(f.event, "second");
  expect(() => f.context.headers(old)).toThrow("C2S_SESSION_CHANGED");
  f.context.clear();
  expect(() => f.context.headers(f.context.bind(tunnel))).toThrow(
    "C2S_AUTH_REQUIRED",
  );
});
it("rejects child frames and unrelated windows before changing credentials", () => {
  const f = fixture();
  expect(() =>
    f.context.set(
      { ...f.event, senderFrame: { url: f.event.senderFrame.url } },
      "token",
    ),
  ).toThrow("C2S_TRUSTED_WINDOW_REQUIRED");
  expect(() => f.context.set({ ...f.event, sender: {} }, "token")).toThrow(
    "C2S_TRUSTED_WINDOW_REQUIRED",
  );
  f.event.senderFrame.url = "https://untrusted.invalid";
  expect(() => f.context.set(f.event, "token")).toThrow(
    "C2S_TRUSTED_WINDOW_REQUIRED",
  );
  expect(f.changed).not.toHaveBeenCalled();
});

it("cancels only the selected tunnel group and releases completed requests", () => {
  const f = fixture();
  f.context.set(f.event, "token");
  const bound = f.context.bind(tunnel);
  const first = f.context.request(bound, "first"),
    verify = f.context.request(bound, "first"),
    second = f.context.request(bound, "second");
  f.context.cancel("first");
  expect(first.signal.aborted).toBe(true);
  expect(verify.signal.reason.message).toBe("C2S_CANCELLED");
  expect(second.signal.aborted).toBe(false);
  const replacement = f.context.request(bound, "first");
  first.release();
  verify.release();
  expect(replacement.signal.aborted).toBe(false);
  f.context.cancel("first");
  expect(replacement.signal.aborted).toBe(true);
  second.release();
  f.context.cancel("second");
  expect(second.signal.aborted).toBe(false);
  expect(f.context.requests.size).toBe(0);
});
it("revokes every pending request on logout and rejects stale registration", () => {
  const f = fixture();
  f.context.set(f.event, "token");
  const bound = f.context.bind(tunnel);
  const first = f.context.request(bound, "first"),
    second = f.context.request(bound, "second");
  f.context.clear();
  expect(first.signal.reason.message).toBe("C2S_SESSION_CHANGED");
  expect(second.signal.aborted).toBe(true);
  expect(f.context.requests.size).toBe(0);
  f.context.set(f.event, "new-token");
  expect(() => f.context.request(bound, "late")).toThrow("C2S_SESSION_CHANGED");
});

it("keeps the replacement start alive while cancelling the failed instance's probes", () => {
  const f = fixture();
  f.context.set(f.event, "token");
  const bound = f.context.bind(tunnel);
  const old = f.context.request(bound, "same"),
    replacement = f.context.request(bound, "same");
  f.context.cancel("same", "C2S_CANCELLED", replacement.signal);
  expect(old.signal.aborted).toBe(true);
  expect(replacement.signal.aborted).toBe(false);
  old.release();
  replacement.release();
  expect(f.context.requests.size).toBe(0);
});
