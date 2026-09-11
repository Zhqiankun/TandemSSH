import { beforeEach, expect, it, vi } from "vitest";
import { SessionControl } from "../../collaboration/sessions/control.js";
const ports = vi.hoisted(() => ({
  data: new Map<string, string>(),
  set: vi.fn(),
  record: vi.fn(),
  sessions: [] as Array<{ control: SessionControl }>,
}));
vi.mock("../../collaboration/recovery/store-production.js", () => ({
  taskRecoveryStore: {},
}));
vi.mock("../../files/directory-transfer-production.js", () => ({
  directoryTransfers: {},
}));
vi.mock("../../files/automated-transfer-production.js", () => ({
  automatedTransfers: {},
}));
vi.mock("../../files/local-file-production.js", () => ({
  bindLocalTaskContext: vi.fn(),
  localFileGrants: {},
}));
vi.mock("../../files/production.js", () => ({ automatedDocuments: {} }));
vi.mock("../../hosts/terminal/session-manager.js", () => ({
  sessionManager: { getUserSessions: () => ports.sessions },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: (key: string) => ports.data.get(key),
  createCurrentSettingsRepository: () => ({ set: ports.set }),
  createCurrentHostRepository: () => ({}),
}));
vi.mock("../../collaboration/audit/production.js", () => ({
  journalFor: () => ({ record: ports.record }),
}));
import {
  readPolicy,
  savePolicy,
} from "../../collaboration/tasks/production.js";
beforeEach(() => {
  ports.data.clear();
  ports.sessions = [];
  ports.set
    .mockReset()
    .mockImplementation(async (key: string, value: string) => {
      ports.data.set(key, value);
    });
  ports.record.mockReset().mockResolvedValue(undefined);
});
function controlled() {
  const control = new SessionControl(
    "session",
    { isReady: () => true, write: vi.fn() },
    () => {},
  );
  const lease = control.grant(
    { kind: "automation", ownerType: "agent-task", ownerId: "task" },
    control.snapshot(),
  );
  ports.sessions.push({ control });
  return { control, lease };
}
it.each(["audit", "storage"])(
  "keeps previous policy and revokes old control when %s fails",
  async (failure) => {
    const { control, lease } = controlled();
    const initial = readPolicy("owner");
    if (failure === "audit")
      ports.record.mockRejectedValueOnce(Error("audit failed"));
    else ports.set.mockRejectedValueOnce(Error("disk full"));
    await expect(savePolicy("owner", initial.revision, [])).rejects.toThrow();
    expect(readPolicy("owner")).toEqual(initial);
    expect(control.snapshot().controller.kind).toBe("human");
    expect(() => control.assertLease(lease)).toThrow();
    if (failure === "audit") expect(ports.set).not.toHaveBeenCalled();
    await expect(
      savePolicy("owner", initial.revision, []),
    ).resolves.toMatchObject({ revision: 2, sets: [] });
  },
);
it("serializes a user's pending save and rejects stale revisions after commit", async () => {
  const { control, lease } = controlled();
  let release!: () => void;
  ports.record.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = savePolicy("owner", 1, []);
  try {
    expect(control.snapshot().controller.kind).toBe("human");
    expect(() => control.assertLease(lease)).toThrow();
    await expect(savePolicy("owner", 1, [])).rejects.toThrow("POLICY_UPDATING");
    expect(ports.set).not.toHaveBeenCalled();
  } finally {
    release();
    await first;
  }
  await expect(savePolicy("owner", 1, [])).rejects.toThrow("POLICY_CHANGED");
  expect(ports.set).toHaveBeenCalledTimes(1);
});
it("loads the serialized rules after production module reload without sharing users", async () => {
  const sets = readPolicy("owner").sets;
  await savePolicy("owner", 1, sets);
  vi.resetModules();
  const restarted = await import("../../collaboration/tasks/production.js");
  expect(restarted.readPolicy("owner")).toEqual({ revision: 2, sets });
  expect(restarted.readPolicy("other").revision).toBe(1);
});
it("fails closed on corrupt stored policy rather than reverting to defaults", () => {
  ports.data.set("tandem-policy:owner", "not json");
  expect(() => readPolicy("owner")).toThrow("POLICY_UNAVAILABLE");
});
