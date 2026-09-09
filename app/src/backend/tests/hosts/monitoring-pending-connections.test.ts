import { afterEach, expect, it, vi } from "vitest";
import { PendingMonitoringConnections } from "../../hosts/metrics/pending-connections";
afterEach(() => vi.useRealTimers());
it("only cancels pending resources belonging to the requested user, host and window", () => {
  const registry = new PendingMonitoringConnections(),
    a = registry.begin(7, "alice", "window-a"),
    b = registry.begin(7, "alice", "window-b"),
    c = registry.begin(7, "bob", "window-c");
  const closeA = vi.fn(),
    closeB = vi.fn(),
    closeC = vi.fn();
  a.own(closeA);
  b.own(closeB);
  c.own(closeC);
  registry.cancel(8, "alice", "window-a");
  registry.cancel(7, "bob", "window-a");
  expect(closeA).not.toHaveBeenCalled();
  registry.cancel(7, "alice", "window-a");
  expect(closeA).toHaveBeenCalledOnce();
  expect(a.signal.aborted).toBe(true);
  expect(closeB).not.toHaveBeenCalled();
  expect(closeC).not.toHaveBeenCalled();
  expect(registry.owns(7, "alice", "window-a")).toBe(false);
  const late = vi.fn();
  expect(() => a.own(late)).toThrow("MONITORING_CANCELLED");
  expect(late).toHaveBeenCalledOnce();
  b.complete();
  registry.cancel(7, "alice");
  expect(closeB).not.toHaveBeenCalled();
  c.cancel();
});
it("expires a stalled connection and refuses viewer ID collisions", () => {
  vi.useFakeTimers();
  const registry = new PendingMonitoringConnections(25),
    a = registry.begin(7, "alice", "same"),
    close = vi.fn();
  a.own(close);
  expect(() => registry.begin(8, "bob", "same")).toThrow(
    "MONITORING_CONNECTION_BUSY",
  );
  vi.advanceTimersByTime(25);
  expect(a.signal.reason.message).toBe("MONITORING_TIMEOUT");
  expect(close).toHaveBeenCalledOnce();
  expect(registry.owns(7, "alice", "same")).toBe(false);
});

it("cancels a background handshake without cancelling another window's handshake", () => {
  const registry = new PendingMonitoringConnections(),
    background = registry.begin(7, "alice", "poll", true),
    window = registry.begin(7, "alice", "window");
  const close = vi.fn(),
    closeWindow = vi.fn();
  background.own(close);
  window.own(closeWindow);
  registry.cancelBackground(7);
  expect(close).toHaveBeenCalledOnce();
  expect(closeWindow).not.toHaveBeenCalled();
  expect(registry.owns(7, "alice", "window")).toBe(true);
  window.cancel();
});

it("preserves the existing three-minute user authentication window", () => {
  vi.useFakeTimers();
  const registry = new PendingMonitoringConnections(25),
    pending = registry.begin(7, "alice", "otp");
  pending.waitForAuthentication();
  vi.advanceTimersByTime(179999);
  expect(pending.signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(pending.signal.aborted).toBe(true);
});
