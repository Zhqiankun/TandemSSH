import { expect, it } from "vitest";
import { inactiveImportedHost } from "../../../database/routes/host-import-activation.js";
it("retains reviewed connection definitions while clearing activation, including overwrite credentials", () => {
  const original = {
    ip: "127.0.0.1",
    port: 22,
    password: "connection-only",
    terminalConfig: '{"fontSize":16}',
    enableTunnel: true,
    enableDocker: true,
    enableProxmox: true,
    enableTmuxMonitor: true,
    autostartPassword: "old-autostart",
    autostartKey: "old-key",
    autostartKeyPassword: "old-passphrase",
    statsConfig: JSON.stringify({
      metricsEnabled: true,
      statusCheckEnabled: true,
      disableTcpPing: false,
      metricsInterval: 17,
    }),
    tunnelConnections: JSON.stringify([
      { id: "t", autoStart: true, sourcePort: 1234, endpointPort: 22 },
    ]),
  };
  const result = inactiveImportedHost(original);
  expect(result).toMatchObject({
    ip: original.ip,
    port: 22,
    password: "connection-only",
    terminalConfig: original.terminalConfig,
    enableTunnel: false,
    enableDocker: false,
    enableProxmox: false,
    enableTmuxMonitor: false,
    autostartPassword: null,
    autostartKey: null,
    autostartKeyPassword: null,
  });
  expect(JSON.parse(result.statsConfig as string)).toEqual({
    metricsEnabled: false,
    statusCheckEnabled: false,
    disableTcpPing: true,
    metricsInterval: 17,
  });
  expect(JSON.parse(result.tunnelConnections as string)).toEqual([
    { id: "t", autoStart: false, sourcePort: 1234, endpointPort: 22 },
  ]);
  expect(original.autostartPassword).toBe("old-autostart");
  expect(JSON.parse(original.tunnelConnections)[0].autoStart).toBe(true);
});
it("writes explicit disabled defaults when an SSH config carries no activation configuration", () => {
  const result = inactiveImportedHost({
    statsConfig: null,
    tunnelConnections: "[]",
  });
  expect(JSON.parse(result.statsConfig as string)).toEqual({
    metricsEnabled: false,
    statusCheckEnabled: false,
    disableTcpPing: true,
  });
  expect(JSON.parse(result.tunnelConnections as string)).toEqual([]);
});
it.each([
  { statsConfig: "{" },
  { statsConfig: "[]" },
  { tunnelConnections: "{}" },
  { tunnelConnections: "[null]" },
])("rejects malformed activation data before persistence: %j", (record) => {
  expect(() => inactiveImportedHost(record)).toThrow(
    "INVALID_IMPORTED_ACTIVATION_CONFIG",
  );
});
