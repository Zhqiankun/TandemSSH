import { expect, it } from "vitest";
import { findHostByTunnelEndpoint } from "../../../features/tunnel/tunnel-endpoints.js";
it("prefers an explicit endpoint ID over another host's numeric name", () => {
  const hosts = [
    { id: 1, name: "2", ip: "10.0.0.1" },
    { id: 2, name: "target", ip: "10.0.0.2" },
  ];
  expect(findHostByTunnelEndpoint(hosts, "2")).toBe(hosts[1]);
  expect(findHostByTunnelEndpoint(hosts, "target")).toBe(hosts[1]);
});
