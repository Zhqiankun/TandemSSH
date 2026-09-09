import { afterEach, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import {
  cleanupMetricsSession,
  metricsSessions,
  scheduleMetricsSessionCleanup,
} from "../../hosts/metrics/sessions";
vi.mock("../../utils/logger.js", () => ({ statsLogger: { warn: vi.fn() } }));
afterEach(() => {
  for (const key of Object.keys(metricsSessions)) {
    clearTimeout(metricsSessions[key].timeout);
    delete metricsSessions[key];
  }
  vi.useRealTimers();
});
function session(client: Client, activeOperations = 0) {
  return {
    client,
    isConnected: true,
    lastActive: 0,
    activeOperations,
    hostId: 7,
    userId: "alice",
  };
}
it("defers active cleanup but a late cleanup cannot close a replacement client", () => {
  const oldEnd = vi.fn(),
    newEnd = vi.fn(),
    oldClient = { end: oldEnd } as unknown as Client,
    newClient = { end: newEnd } as unknown as Client;
  metricsSessions.key = session(oldClient, 1);
  cleanupMetricsSession("key", oldClient);
  expect(metricsSessions.key.cleanupRequested).toBe(true);
  expect(oldEnd).not.toHaveBeenCalled();
  clearTimeout(metricsSessions.key.timeout);
  metricsSessions.key = session(newClient);
  cleanupMetricsSession("key", oldClient);
  expect(newEnd).not.toHaveBeenCalled();
  cleanupMetricsSession("key", newClient);
  expect(newEnd).toHaveBeenCalledOnce();
  expect(metricsSessions.key).toBeUndefined();
});
it("an old idle timeout cannot close a new session under the same key", () => {
  vi.useFakeTimers();
  const oldClient = { end: vi.fn() } as unknown as Client,
    close = vi.fn(),
    replacement = { end: close } as unknown as Client;
  metricsSessions.key = session(oldClient);
  scheduleMetricsSessionCleanup("key");
  metricsSessions.key = session(replacement);
  vi.advanceTimersByTime(30 * 60 * 1000);
  expect(close).not.toHaveBeenCalled();
  expect(metricsSessions.key.client).toBe(replacement);
});
