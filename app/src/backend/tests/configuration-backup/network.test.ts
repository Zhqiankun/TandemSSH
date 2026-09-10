import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  projectConfigurationBackup,
  parseConfigurationBackup,
} from "../../configuration-backup/schema.js";
import {
  restoreTunnel,
  validateNetworkReferences,
} from "../../configuration-backup/network.js";
const host = (id: number, name: string) => ({
  id,
  name,
  ip: `10.0.0.${id}`,
  port: 22,
  username: "fixture",
  authType: "key",
  connectionType: "ssh",
});
it("exports all tunnel modes and maps jump and endpoint references without secrets", () => {
  const first = {
      ...host(1, "source"),
      jumpHosts: '[{"hostId":2}]',
      tunnelConnections: ["local", "remote", "dynamic"].map((mode) => ({
        mode,
        scope: "s2s",
        endpointHost: "target",
        sourcePort: 8000,
        endpointPort: 22,
        autoStart: true,
        endpointPassword: "never-export",
        endpointKey: "secret-key",
      })),
    },
    second = host(2, "target");
  const { payload } = projectConfigurationBackup(
    [first, second],
    [],
    undefined,
    undefined,
    undefined,
    [
      {
        name: "client",
        config: JSON.stringify([
          {
            sourceHostId: 1,
            mode: "dynamic",
            sourcePort: 1080,
            autoStart: true,
          },
        ]),
      },
    ],
  );
  expect(payload.version).toBe(3);
  expect(JSON.stringify(payload)).not.toMatch(
    /never-export|secret-key|autoStart/,
  );
  expect(payload.hosts[0].network?.jumpHostRefs).toEqual([
    payload.hosts[1].ref,
  ]);
  expect(payload.hosts[0].network?.tunnels.map((t) => t.mode)).toEqual([
    "local",
    "remote",
    "dynamic",
  ]);
  expect(payload.tunnelPresets?.[0].tunnels[0].scope).toBe("c2s");
  const ids = new Map([
    [payload.hosts[0].ref, 91],
    [payload.hosts[1].ref, 92],
  ]);
  expect(
    restoreTunnel(payload.hosts[0].network!.tunnels[0], ids),
  ).toMatchObject({ sourceHostId: 91, endpointHost: "92", autoStart: false });
});
it("retains direct local destinations without turning them into an unrelated host reference", () => {
  const first = {
    ...host(1, "source"),
    tunnelConnections: [
      {
        sourcePort: 8000,
        endpointPort: 9000,
        endpointHost: "unlisted.example",
        mode: "local",
      },
    ],
  };
  const { payload } = projectConfigurationBackup([first], []);
  const t = payload.hosts[0].network!.tunnels[0];
  expect(t.endpointHostRef).toBeUndefined();
  expect(t.targetHost).toBe("unlisted.example");
  expect(restoreTunnel(t, new Map([[payload.hosts[0].ref, 99]]))).toMatchObject(
    { endpointHost: "", targetHost: "unlisted.example" },
  );
});
it("rejects missing jump references, cycles, and deeply nested chains", () => {
  const a = randomUUID(),
    b = randomUUID();
  expect(() =>
    validateNetworkReferences(
      [{ ref: a, network: { jumpHostRefs: [b], tunnels: [] } }],
      [],
    ),
  ).toThrow("BACKUP_HOST_REFERENCE");
  expect(() =>
    validateNetworkReferences(
      [
        { ref: a, network: { jumpHostRefs: [b], tunnels: [] } },
        { ref: b, network: { jumpHostRefs: [a], tunnels: [] } },
      ],
      [],
    ),
  ).toThrow("BACKUP_JUMP_CYCLE");
  const refs = Array.from({ length: 11 }, () => randomUUID());
  expect(() =>
    validateNetworkReferences(
      refs.map((ref, i) => ({
        ref,
        network: { jumpHostRefs: i < 10 ? [refs[i + 1]] : [], tunnels: [] },
      })),
      [],
    ),
  ).toThrow("BACKUP_JUMP_DEPTH");
});
it("does not activate v3 network fields hidden in legacy backups", () => {
  const { payload } = projectConfigurationBackup([host(1, "source")], []);
  payload.version = 2;
  payload.hosts[0].network = { jumpHostRefs: [randomUUID()], tunnels: [] };
  const parsed = parseConfigurationBackup(payload);
  expect(parsed.payload.hosts[0].network).toBeUndefined();
  expect(parsed.payload.tunnelPresets).toEqual([]);
});
it("reports excluded references instead of reconnecting through an old database ID", () => {
  const { payload, warnings } = projectConfigurationBackup(
    [{ ...host(1, "source"), jumpHosts: [{ hostId: 999 }] }],
    [],
  );
  expect(payload.hosts[0].network?.jumpHostRefs).toEqual([]);
  expect(warnings.some((w) => w.code === "NETWORK_REFERENCE_EXCLUDED")).toBe(
    true,
  );
});
it("rejects ambiguous endpoint names and reports damaged network configuration", () => {
  const source = {
    ...host(1, "source"),
    tunnelConnections: [
      { endpointHost: "duplicate", sourcePort: 8000, endpointPort: 22 },
    ],
  };
  expect(() =>
    projectConfigurationBackup(
      [source, host(2, "duplicate"), host(3, "duplicate")],
      [],
    ),
  ).toThrow("BACKUP_AMBIGUOUS_ENDPOINT");
  const { warnings } = projectConfigurationBackup(
    [{ ...host(1, "source"), jumpHosts: "broken" }],
    [],
  );
  expect(warnings.some((w) => w.code === "NETWORK_CONFIG_EXCLUDED")).toBe(true);
});
it("drops a network configuration whose address would be redacted, rather than changing its destination", () => {
  const { payload, warnings } = projectConfigurationBackup(
    [
      {
        ...host(1, "source"),
        tunnelConnections: [
          {
            sourcePort: 8000,
            endpointPort: 80,
            targetHost: "token=fixture-secret",
          },
        ],
      },
    ],
    [],
  );
  expect(payload.hosts[0].network).toBeUndefined();
  expect(warnings.some((w) => w.code === "NETWORK_CONFIG_EXCLUDED")).toBe(true);
});
it("continues ignoring malformed unknown network fields in old formats, but rejects them in v3", () => {
  const { payload } = projectConfigurationBackup([host(1, "source")], []);
  const input = {
    ...payload,
    version: 2,
    hosts: [{ ...payload.hosts[0], network: "old opaque extension" }],
    tunnelPresets: "old opaque extension",
  };
  const parsed = parseConfigurationBackup(input);
  expect(parsed.payload.hosts[0].network).toBeUndefined();
  expect(parsed.payload.tunnelPresets).toEqual([]);
  expect(
    parsed.warnings.filter((w) => w.code === "IGNORED_FIELD").length,
  ).toBeGreaterThanOrEqual(2);
  expect(() => parseConfigurationBackup({ ...input, version: 3 })).toThrow();
});
