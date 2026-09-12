import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { McpCorePorts } from "../../mcp/core.js";
import { McpCore } from "../../mcp/core.js";
const state = vi.hoisted(() => ({
  ports: undefined as unknown as McpCorePorts,
  getSession: vi.fn(),
  output: vi.fn(),
  hosts: vi.fn(),
  owns: vi.fn(),
}));
vi.mock("../../mcp/core.js", async (original) => {
  const actual = await original<typeof import("../../mcp/core.js")>();
  return {
    ...actual,
    McpCore: class extends actual.McpCore {
      constructor(ports: McpCorePorts) {
        super(ports);
        state.ports = ports;
      }
    },
  };
});
vi.mock("../../collaboration/recovery/production.js", () => ({
  taskRecovery: {},
}));
vi.mock("../../collaboration/files/production.js", () => ({
  fileAutomation: {},
  transferAutomation: {},
  directoryAutomation: {},
}));
vi.mock("../../collaboration/workflows/production.js", () => ({
  workflows: {},
}));
vi.mock("../../collaboration/tasks/production.js", () => ({
  taskRuntime: {},
  listSessions: () => [],
  journalFor: () => ({}),
}));
vi.mock("../../runtime/policy.js", () => ({
  runtimePolicy: { desktop: true },
}));
vi.mock("../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {
    getSession: state.getSession,
    getOutputSnapshot: state.output,
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({
    listDecryptedByUserId: state.hosts,
    findByIdForUser: state.owns,
  }),
  createCurrentSettingsRepository: () => ({}),
  getCurrentSettingValue: () => undefined,
}));
vi.mock("../../mcp/credential-store.js", () => ({
  SystemPairingSecretStore: class {},
}));
import { desktopSessionRequests } from "../../mcp/production.js";
const principal = {
  userId: "owner",
  clientId: randomUUID(),
  connectionId: randomUUID(),
  allowedHostIds: [7],
  readTerminal: true,
};
const sessionId = randomUUID();
beforeEach(() => {
  vi.clearAllMocks();
  state.getSession.mockReturnValue({
    id: sessionId,
    userId: "owner",
    hostId: 7,
  });
  state.output.mockReturnValue({
    text: "已有终端内容",
    cursor: 12,
    firstCursor: 0,
    generation: 1,
  });
});
const invoke = (
  method: Parameters<McpCore["invoke"]>[1],
  input: Record<string, unknown>,
  identity = principal,
) =>
  new McpCore(state.ports).invoke(
    identity,
    method,
    input,
    new AbortController().signal,
  );
it.each(["other-user", "unlisted-host", "missing-session"] as const)(
  "production terminal output rejects %s before reading history",
  async (boundary) => {
    if (boundary === "missing-session")
      state.getSession.mockReturnValue(undefined);
    const identity = {
      ...principal,
      ...(boundary === "other-user" ? { userId: "stranger" } : {}),
      ...(boundary === "unlisted-host" ? { allowedHostIds: [8] } : {}),
    };
    await expect(
      invoke("sessions.output", { sessionId }, identity),
    ).rejects.toThrow("SESSION_NOT_FOUND");
    expect(state.output).not.toHaveBeenCalled();
  },
);
it("readTerminal opt-in is independent of host access and checked before session lookup", async () => {
  await expect(
    invoke(
      "sessions.output",
      { sessionId },
      { ...principal, readTerminal: false },
    ),
  ).rejects.toThrow("MCP_TERMINAL_READ_DENIED");
  expect(state.getSession).not.toHaveBeenCalled();
  expect(state.output).not.toHaveBeenCalled();
  expect(await invoke("sessions.output", { sessionId })).toMatchObject({
    text: "已有终端内容",
    contentTrust: "untrusted-terminal-output",
  });
});
it("production host listing projects metadata only and restricts the repository query to the current owner", async () => {
  state.hosts.mockResolvedValue([
    {
      id: 7,
      name: "服务器",
      ip: "127.0.0.1",
      port: 22,
      password: "fixture-password",
      privateKey: "fixture-private-key",
    },
    { id: 8, name: "未授权", ip: "127.0.0.2", port: 22 },
  ]);
  expect(await invoke("hosts.list", {})).toEqual({
    hosts: [{ id: 7, name: "服务器", address: "127.0.0.1", port: 22 }],
  });
  expect(state.hosts).toHaveBeenCalledWith("owner");
});
it("production open checks pairing scope and repository ownership before requesting desktop work", async () => {
  const open = vi
    .spyOn(desktopSessionRequests, "open")
    .mockReturnValue({ id: randomUUID(), state: "pending" } as ReturnType<
      typeof desktopSessionRequests.open
    >);
  try {
    await expect(
      invoke("sessions.open", { hostId: 8, requestId: "outside" }),
    ).rejects.toThrow("HOST_NOT_FOUND");
    expect(state.owns).not.toHaveBeenCalled();
    state.owns.mockResolvedValue(null);
    await expect(
      invoke(
        "sessions.open",
        { hostId: 7, requestId: "foreign" },
        { ...principal, userId: "stranger" },
      ),
    ).rejects.toThrow("HOST_NOT_FOUND");
    expect(state.owns).toHaveBeenCalledWith("stranger", 7);
    expect(open).not.toHaveBeenCalled();
    state.owns.mockResolvedValue({ id: 7 });
    expect(
      await invoke("sessions.open", { hostId: 7, requestId: "owned" }),
    ).toMatchObject({ state: "pending" });
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(principal, 7, "owned");
  } finally {
    open.mockRestore();
  }
});
