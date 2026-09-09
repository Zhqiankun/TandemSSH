import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  parseConfigurationBackup,
  projectConfigurationBackup,
  MAX_BACKUP_BYTES,
} from "../../configuration-backup/schema.js";
import { ConfigurationBackupService } from "../../configuration-backup/service.js";
const flow = {
  schemaVersion: 1,
  id: "check",
  name: "巡检",
  version: "1.0.0",
  parameters: {},
  defaults: { cwd: "/srv" },
  steps: [
    {
      id: "print",
      name: "检查",
      action: { type: "command", program: "printf", args: ["ready"] },
    },
  ],
};
function input() {
  return {
    format: "tandemssh-configuration",
    version: 1,
    createdAt: new Date().toISOString(),
    hosts: [
      {
        ref: randomUUID(),
        name: "测试主机",
        ip: "127.0.0.1",
        port: 22,
        username: "fixture",
        credentialRef: "source-credential:7",
        originalAuthType: "agent",
      },
    ],
    workflows: [{ ref: randomUUID(), definition: structuredClone(flow) }],
  };
}
function fixture() {
  const apply = vi.fn(async (_user: string, request: { id: string }) => ({
      receiptId: request.id,
      hostIds: [1],
      workflowIds: ["flow"],
      preferencesRestored: false,
    })),
    audit = vi.fn(async () => {});
  const service = new ConfigurationBackupService({
    snapshot: async () => ({
      fingerprint: "snapshot",
      hosts: [],
      workflows: [],
    }),
    apply,
    audit,
  });
  return { service, apply, audit };
}
afterEach(() => vi.useRealTimers());
describe("configuration backup boundaries", () => {
  it("projects only supported host fields and removes credentials, startup and provider keys", () => {
    const { payload, warnings } = projectConfigurationBackup(
      [
        {
          id: 4,
          ip: "127.0.0.1",
          port: 22,
          username: "fixture",
          password: "fixture-password",
          key: "fixture-private-key",
          terminalConfig: { autoExecute: "echo unwanted" },
          notes: "token=fixture-secret",
          tags: '["test"]',
        },
      ],
      [],
      { apiKey: "fixture-api-key" },
    );
    const out = JSON.stringify(payload);
    for (const value of [
      "fixture-password",
      "fixture-private-key",
      "unwanted",
      "fixture-secret",
      "fixture-api-key",
    ])
      expect(out).not.toContain(value);
    expect(payload.hosts[0].notes).toContain("[redacted]");
    expect(
      warnings.some((w) => w.code === "SECRETS_AND_STARTUP_EXCLUDED"),
    ).toBe(true);
  });
  it("strips unknown fields without preserving an execution instruction", () => {
    const data = input();
    Object.assign(data, {
      password: "fixture",
      runAfterImport: "echo unwanted",
    });
    const { payload, warnings } = parseConfigurationBackup(data);
    expect(payload).not.toHaveProperty("runAfterImport");
    expect(warnings.some((w) => w.code === "IGNORED_FIELD")).toBe(true);
  });
  it("keeps secret references but excludes literal secrets even when reference names collide", () => {
    const data = input();
    Object.assign(data.workflows[0].definition.parameters, {
      token: { type: "secret-ref" },
      reference_0: { type: "string", default: "ready" },
    });
    expect(parseConfigurationBackup(data).payload.workflows).toHaveLength(1);
    Object.assign(data.workflows[0].definition.parameters, {
      reference_0: { type: "string", default: "password=fixture-leak" },
    });
    expect(parseConfigurationBackup(data).payload.workflows).toHaveLength(0);
  });
  it("rejects duplicate references and unsupported versions", () => {
    const data = input();
    data.hosts.push({ ...data.hosts[0] });
    expect(() => parseConfigurationBackup(data)).toThrow(
      "BACKUP_DUPLICATE_REFERENCE",
    );
    expect(() =>
      parseConfigurationBackup({ ...input(), version: 99 }),
    ).toThrow();
  });
  it("never mutates during preview and requires the owning user and matching direction", async () => {
    const f = fixture(),
      p = await f.service.previewImport("owner", JSON.stringify(input()));
    expect(f.apply).not.toHaveBeenCalled();
    expect(p.bytes).toBe(Buffer.byteLength(p.content));
    expect(() => f.service.apply("other", p.id, false)).toThrow(
      "BACKUP_PREVIEW_NOT_FOUND",
    );
    await expect(f.service.download("owner", p.id)).rejects.toThrow(
      "BACKUP_PREVIEW_NOT_FOUND",
    );
  });
  it("reuses simultaneous confirmations and refuses changed options", async () => {
    const f = fixture(),
      p = await f.service.previewImport("owner", JSON.stringify(input()));
    const a = f.service.apply("owner", p.id, false),
      b = f.service.apply("owner", p.id, false);
    expect(a).toBe(b);
    expect(() => f.service.apply("owner", p.id, true)).toThrow(
      "BACKUP_CONFIRMATION_CHANGED",
    );
    await a;
    expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it("expires unconfirmed previews and bounds uploaded bytes", async () => {
    vi.useFakeTimers();
    const f = fixture(),
      p = await f.service.previewImport("owner", JSON.stringify(input()));
    vi.advanceTimersByTime(300001);
    expect(() => f.service.apply("owner", p.id, false)).toThrow(
      "BACKUP_PREVIEW_EXPIRED",
    );
    await expect(
      f.service.previewImport("owner", " ".repeat(MAX_BACKUP_BYTES + 1)),
    ).rejects.toThrow("BACKUP_TOO_LARGE");
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("can retry a failed apply without evicting the pending retry after preview expiry", async () => {
    vi.useFakeTimers();
    const f = fixture(),
      p = await f.service.previewImport("owner", JSON.stringify(input()));
    f.apply.mockRejectedValueOnce(Error("fixture-failure"));
    await expect(f.service.apply("owner", p.id, false)).rejects.toThrow(
      "fixture-failure",
    );
    let release!: () => void;
    f.apply.mockImplementationOnce(async (_u, r) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        receiptId: r.id,
        hostIds: [1],
        workflowIds: [],
        preferencesRestored: false,
      };
    });
    const retry = f.service.apply("owner", p.id, false);
    await Promise.resolve();
    vi.advanceTimersByTime(300001);
    await f.service.previewExport("owner");
    expect(f.service.apply("owner", p.id, false)).toBe(retry);
    release();
    await retry;
  });
});

it("redacts recognized secrets from supported preference string fields", () => {
  const data = input();
  Object.assign(data, {
    preferences: {
      overrides: {
        rail: { hiddenTabs: ["hosts", "token=fixture-preference-secret"] },
      },
      onboarding: { completedAt: "password=fixture-onboarding-secret" },
    },
  });
  const { payload, warnings } = parseConfigurationBackup(data);
  const out = JSON.stringify(payload);
  expect(out).not.toContain("fixture-preference-secret");
  expect(out).not.toContain("fixture-onboarding-secret");
  expect(warnings.some((w) => w.code === "PREFERENCE_SECRET_REDACTED")).toBe(
    true,
  );
});

it("accepts version 1 backups and exports current local appearance in version 2", async () => {
  expect(parseConfigurationBackup(input()).payload.version).toBe(2);
  const f = fixture(),
    p = await f.service.previewExport("owner", {
      appearance: {
        theme: "nord",
        fontSize: "lg",
        accentColor: "#123456",
        language: "zh-CN",
      },
    });
  const data = JSON.parse(p.content);
  expect(data.version).toBe(2);
  expect(data.appearance).toMatchObject({ theme: "nord", fontSize: "lg" });
  expect(() =>
    parseConfigurationBackup({
      ...input(),
      appearance: { theme: "untrusted-css" },
    }),
  ).toThrow();
});
it("freezes shortcut restore choice in the confirmation", async () => {
  const f = fixture(),
    p = await f.service.previewImport("owner", JSON.stringify(input()));
  await f.service.apply("owner", p.id, false, true);
  expect(() => f.service.apply("owner", p.id, false, false)).toThrow(
    "BACKUP_CONFIRMATION_CHANGED",
  );
  expect(f.apply).toHaveBeenCalledTimes(1);
});
it("excludes shortcut literal secrets and removes snippet identity on disabled restore", async () => {
  const { projectKeybindings, restoreKeybindings } =
    await import("../../configuration-backup/keyboard.js");
  const combo = {
    key: "k",
    isCode: false,
    ctrl: true,
    alt: false,
    shift: true,
    meta: false,
  };
  const { bindings, excluded } = projectKeybindings([
    {
      id: "source",
      combo,
      action: { type: "runSnippet", snippetId: "7" },
      enabled: true,
    },
    {
      id: "source-secret",
      combo,
      action: { type: "sendText", text: "token=fixture-secret" },
      enabled: true,
    },
  ]);
  expect(excluded).toBe(1);
  expect(bindings[0].action).toEqual({ type: "runSnippet", snippetRef: "7" });
  const restored = restoreKeybindings(bindings)[0];
  expect(restored).toMatchObject({
    enabled: false,
    needsReview: true,
    action: { type: "runSnippet", snippetId: "" },
  });
  expect(restored.id).not.toBe("source");
});

it("preserves built-in shortcut override identity while keeping restoration disabled", async () => {
  const { projectKeybindings, restoreKeybindings } =
    await import("../../configuration-backup/keyboard.js");
  const original = {
    id: "override",
    combo: {
      key: "q",
      isCode: false,
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    action: { type: "sendControlCode", controlCode: "q" },
    enabled: true,
    overridesDefaultId: "default-ctrlaltq",
  };
  const data = projectKeybindings([original]);
  expect(data.bindings[0].overridesDefaultId).toBe("default-ctrlaltq");
  expect(restoreKeybindings(data.bindings)[0]).toMatchObject({
    overridesDefaultId: "default-ctrlaltq",
    enabled: false,
    needsReview: true,
  });
});

it("preserves valid three-digit accent colors supported by the desktop editor", () => {
  const { payload } = parseConfigurationBackup({
    ...input(),
    appearance: { accentColor: "#aBc" },
  });
  expect(payload.appearance?.accentColor).toBe("#aabbcc");
});
