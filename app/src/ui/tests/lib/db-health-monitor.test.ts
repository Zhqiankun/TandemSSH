import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbHealthMonitor,
  isRequestCancellation,
} from "@/lib/db-health-monitor";

describe("database health monitor", () => {
  beforeEach(() => {
    dbHealthMonitor.reset();
  });

  afterEach(() => {
    dbHealthMonitor.reset();
  });

  it.each([
    { code: "ERR_CANCELED", message: "canceled" },
    { code: "ABORT_ERR", message: "The operation was aborted" },
    { name: "CanceledError", message: "canceled" },
    { name: "AbortError", message: "The operation was aborted" },
    { message: "cancelled" },
  ])("recognizes expected client cancellation %#", (error) => {
    expect(isRequestCancellation(error)).toBe(true);
  });

  it("does not report canceled requests as a backend outage", () => {
    const degraded = vi.fn();
    const restored = vi.fn();
    dbHealthMonitor.on("database-connection-degraded", degraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", restored);

    try {
      dbHealthMonitor.reportDatabaseError({
        code: "ERR_CANCELED",
        message: "canceled",
      });
      dbHealthMonitor.reportDatabaseSuccess();

      expect(dbHealthMonitor.isDegraded()).toBe(false);
      expect(degraded).not.toHaveBeenCalled();
      expect(restored).not.toHaveBeenCalled();
    } finally {
      dbHealthMonitor.off("database-connection-degraded", degraded);
      dbHealthMonitor.off("database-connection-degraded-cleared", restored);
    }
  });

  it("still reports and clears a real network outage once", () => {
    const degraded = vi.fn();
    const restored = vi.fn();
    dbHealthMonitor.on("database-connection-degraded", degraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", restored);

    try {
      dbHealthMonitor.reportDatabaseError({
        code: "ERR_NETWORK",
        message: "Network Error",
      });
      dbHealthMonitor.reportDatabaseError({
        code: "ERR_NETWORK",
        message: "Network Error",
      });

      expect(dbHealthMonitor.isDegraded()).toBe(true);
      expect(degraded).toHaveBeenCalledOnce();

      dbHealthMonitor.reportDatabaseSuccess();
      dbHealthMonitor.reportDatabaseSuccess();

      expect(dbHealthMonitor.isDegraded()).toBe(false);
      expect(restored).toHaveBeenCalledOnce();
    } finally {
      dbHealthMonitor.off("database-connection-degraded", degraded);
      dbHealthMonitor.off("database-connection-degraded-cleared", restored);
    }
  });
});
