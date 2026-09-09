import type { Client } from "ssh2";
import type { TunnelConfig } from "../../../types/index.js";
import { SSHHostKeyVerifier } from "../host-key-verifier.js";
export type TunnelTrustRole = "source" | "endpoint";
export function tunnelTrustTarget(config: TunnelConfig, role: TunnelTrustRole) {
  const userId = config.requestingUserId || config.sourceUserId;
  const address = role === "source" ? config.sourceIP : config.endpointIP;
  const port =
    role === "source" ? config.sourceSSHPort : config.endpointSSHPort;
  if (
    typeof userId !== "string" ||
    !userId ||
    userId.length > 256 ||
    typeof address !== "string" ||
    !address.trim() ||
    address.length > 4096 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("TUNNEL_TRUST_IDENTITY_REQUIRED");
  return {
    userId,
    address,
    port,
    hostId:
      role === "source" &&
      Number.isInteger(config.sourceHostId) &&
      config.sourceHostId > 0
        ? config.sourceHostId
        : null,
  };
}
/** Background tunnel channels use the same explicit trust service as terminals. */
export function tunnelHostVerifier(
  client: Client,
  config: TunnelConfig,
  role: TunnelTrustRole,
) {
  const target = tunnelTrustTarget(config, role);
  return SSHHostKeyVerifier.createHostVerifier(
    target.hostId,
    target.address,
    target.port,
    null,
    target.userId,
    false,
    undefined,
    client,
  );
}
