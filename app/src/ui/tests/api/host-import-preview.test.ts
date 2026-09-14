import { expect, it } from "vitest";
import { importedSettingGroups } from "../../sidebar/host-import-preview";
it("lists configuration categories without exposing values or claiming they are enabled", () => {
  const host = { name: "example", ip: "127.0.0.1", password: "secret-canary", key: "private-canary",
    useSocks5: false, socks5Password: "proxy-canary", jumpHosts: [], terminalConfig: { startup: "command-canary" },
    tunnelConnections: [], statsConfig: { metricsEnabled: false }, dockerConfig: {}, proxmoxConfig: {}, portKnockSequence: [] };
  const before = structuredClone(host);
  const result = importedSettingGroups(host);
  expect(result).toEqual(["authentication", "proxy", "jump", "terminal", "tunnels", "monitoring", "docker", "proxmox", "portKnocking"]);
  expect(JSON.stringify(result)).not.toMatch(/canary/);
  expect(host).toEqual(before);
});
it("omits absent fields and inherited claims", () => {
  expect(importedSettingGroups({ name: "host", ip: "example", port: 22 })).toEqual([]);
  expect(importedSettingGroups(Object.assign(Object.create({ password: "inherited" }), { terminalConfig: null }))).toEqual([]);
});
