import { expect, it } from "vitest";
import { connectLinux } from "../../../test-helpers/linux-ssh-fixture.js";
import { MonitoringCollectionRuntime } from "../../../hosts/metrics/collection-runtime.js";
import { collectCpuMetrics } from "../../../hosts/metrics/widgets/cpu-collector.js";
import { collectMemoryMetrics } from "../../../hosts/metrics/widgets/memory-collector.js";
import { collectDiskMetrics } from "../../../hosts/metrics/widgets/disk-collector.js";
import { collectNetworkMetrics } from "../../../hosts/metrics/widgets/network-collector.js";
import { collectProcessesMetrics } from "../../../hosts/metrics/widgets/processes-collector.js";
import { collectSystemMetrics } from "../../../hosts/metrics/widgets/system-collector.js";

it.skipIf(!process.env.TANDEM_LINUX_MANIFEST)(
  "collects real Linux metrics through the fixed-command runtime",
  async () => {
    const client = await connectLinux();
    const settings = {
      metricsEnabled: true,
      metricsInterval: 30,
      enabledWidgets: [
        "cpu",
        "memory",
        "disk",
        "network",
        "processes",
        "system",
      ],
    };
    const runtime = new MonitoringCollectionRuntime({
      authorize: async (hostId, userId) => {
        if (hostId !== 1 || userId !== "linux-test")
          throw Error("MONITORING_DENIED");
      },
      audit: async () => {},
      batchTimeoutMs: 60_000,
    });
    try {
      const samples = await runtime.run(
        1,
        "linux-test",
        settings,
        async () => ({
          cpu: await collectCpuMetrics(client),
          memory: await collectMemoryMetrics(client),
          disk: await collectDiskMetrics(client),
          network: await collectNetworkMetrics(client),
          processes: await collectProcessesMetrics(client),
          system: await collectSystemMetrics(client),
        }),
      );
      expect(samples.cpu.cores).toBeGreaterThan(0);
      expect(samples.cpu.percent).toBeGreaterThanOrEqual(0);
      expect(samples.cpu.percent).toBeLessThanOrEqual(100);
      expect(samples.cpu.load).toHaveLength(3);
      expect(samples.memory.totalGiB).toBeGreaterThan(0);
      expect(samples.memory.percent).toBeGreaterThanOrEqual(0);
      expect(samples.memory.percent).toBeLessThanOrEqual(100);
      expect(samples.disk.filesystems.length).toBeGreaterThan(0);
      expect(samples.disk.percent).toBeGreaterThanOrEqual(0);
      expect(samples.disk.percent).toBeLessThanOrEqual(100);
      expect(samples.network.interfaces.length).toBeGreaterThan(0);
      for (const iface of samples.network.interfaces) {
        expect(iface.rxBytes).toMatch(/^\d+$/);
        expect(iface.txBytes).toMatch(/^\d+$/);
        expect(iface.rxRateBps).toBeGreaterThanOrEqual(0);
        expect(iface.txRateBps).toBeGreaterThanOrEqual(0);
      }
      expect(samples.processes.total).toBeGreaterThan(0);
      expect(samples.processes.running).toBeGreaterThanOrEqual(0);
      expect(samples.processes.top.length).toBeGreaterThan(0);
      expect(samples.system.os).toContain("Alpine");
      expect(samples.system.hostname).toBeTruthy();
      expect(samples.system.kernel).toBeTruthy();
      const batch = runtime.snapshot(1, "linux-test", settings).recent[0];
      expect(batch.status).toBe("completed");
      expect(batch.actions.length).toBeGreaterThan(15);
      expect(
        batch.actions.every((action) => action.status === "completed"),
      ).toBe(true);
      runtime.pause(1, "linux-test");
      await expect(
        runtime.run(1, "linux-test", settings, () => collectCpuMetrics(client)),
      ).rejects.toThrow("MONITORING_PAUSED");
      expect(runtime.snapshot(1, "linux-test", settings).recent).toHaveLength(
        1,
      );
    } finally {
      client.end();
    }
  },
  90_000,
);
