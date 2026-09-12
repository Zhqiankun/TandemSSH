import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({ sessions: vi.fn() }));
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
  localFileGrants: {},
  bindLocalTaskContext: () => {},
}));
vi.mock("../../files/production.js", () => ({ automatedDocuments: {} }));
vi.mock("../../hosts/terminal/session-manager.js", () => ({
  sessionManager: { getUserSessions: state.sessions },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: () => undefined,
  createCurrentSettingsRepository: () => ({}),
  createCurrentHostRepository: () => ({}),
}));
vi.mock("../../collaboration/audit/production.js", () => ({
  journalFor: () => ({}),
}));
import {
  listSessions,
  taskRuntime,
} from "../../collaboration/tasks/production.js";
import { McpCore } from "../../mcp/core.js";
it("production session listing scopes the owner query, filters hosts and projects only public session fields", async () => {
  const id = randomUUID();
  const control = { controller: { kind: "human" }, generation: 1 };
  state.sessions.mockImplementation((user: string) =>
    user === "owner"
      ? [
          {
            id,
            hostId: 7,
            hostName: "生产",
            isConnected: true,
            control: { snapshot: () => control },
            password: "hidden",
            sshConn: { credential: "hidden" },
            output: "private-history",
          },
          {
            id: randomUUID(),
            hostId: 8,
            hostName: "未授权",
            isConnected: false,
            control: { snapshot: () => control },
          },
        ]
      : [],
  );
  const principal = {
    userId: "owner",
    clientId: randomUUID(),
    connectionId: randomUUID(),
    allowedHostIds: [7],
    readTerminal: false,
  };
  const core = new McpCore({
    tasks: taskRuntime,
    sessions: (p) => listSessions({ kind: "mcp", ...p }),
    hosts: async () => [],
    open: async () => ({}),
    output: () => {
      throw Error("HISTORY_MUST_NOT_BE_READ");
    },
  });
  const read = (hostId?: number, p = principal) =>
    core.invoke(
      p,
      "sessions.list",
      hostId === undefined ? {} : { hostId },
      new AbortController().signal,
    );
  expect(await read()).toEqual({
    sessions: [{ id, hostId: 7, hostName: "生产", connected: true, control }],
  });
  expect(state.sessions).toHaveBeenCalledWith("owner");
  expect(await read(8)).toEqual({ sessions: [] });
  expect(await read(undefined, { ...principal, userId: "stranger" })).toEqual({
    sessions: [],
  });
  expect(state.sessions).toHaveBeenCalledWith("stranger");
  expect(
    await read(undefined, { ...principal, clientId: randomUUID() }),
  ).toEqual(await read());
});
