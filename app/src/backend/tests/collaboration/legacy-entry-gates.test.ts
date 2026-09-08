import { describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  repo: vi.fn(() => {
    throw Error("UNEXPECTED_DATABASE_ACCESS");
  }),
  ssh: vi.fn(() => {
    throw Error("UNEXPECTED_SSH");
  }),
  notify: vi.fn(),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAutomationRepository: calls.repo,
  createCurrentAlertRepository: calls.repo,
  createCurrentSnippetRepository: calls.repo,
  createCurrentHostRepository: calls.repo,
  createCurrentHostResolutionRepository: calls.repo,
  createCurrentSettingsRepository: calls.repo,
  getCurrentSettingValue: () => undefined,
}));
vi.mock("../../hosts/ssh-connection-pool.js", () => ({
  withConnection: calls.ssh,
}));
vi.mock("../../automations/notify.js", () => ({
  sendAutomationNotification: calls.notify,
}));
import { AutomationEngine } from "../../automations/engine";
import { executeStep } from "../../automations/actions/index";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
  tick,
} from "../../automations/scheduler";
import { legacyAutomationExecutionEnabled } from "../../../domain/commands/legacy-policy";
describe("production legacy side effects are closed", () => {
  it.each(["manual", "schedule", "webhook", "metric_threshold"])(
    "rejects %s before loading a definition or opening SSH",
    async (triggerType) => {
      expect(legacyAutomationExecutionEnabled).toBe(false);
      expect(
        await AutomationEngine.getInstance().run({
          automationId: 1,
          triggerType,
        }),
      ).toMatchObject({
        runId: null,
        status: "skipped",
        error: "LEGACY_AUTOMATION_REQUIRES_MIGRATION",
      });
      expect(calls.repo).not.toHaveBeenCalled();
      expect(calls.ssh).not.toHaveBeenCalled();
    },
  );
  it("rejects a direct legacy action and does not start timers or polling", async () => {
    const result = await executeStep(
      { type: "run_command" } as Parameters<typeof executeStep>[0],
      { dryRun: false } as Parameters<typeof executeStep>[1],
    );
    expect(result.success).toBe(false);
    startAutomationScheduler();
    await tick();
    stopAutomationScheduler();
    expect(calls.repo).not.toHaveBeenCalled();
    expect(calls.ssh).not.toHaveBeenCalled();
    expect(calls.notify).not.toHaveBeenCalled();
  });
});
