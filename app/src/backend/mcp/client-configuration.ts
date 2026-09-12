import type {
  McpClientConfiguration,
  McpPairing,
} from "../../types/mcp-pairing.js";
export interface ClientConfigurationPorts {
  list(userId: string): McpPairing[];
  start(): Promise<{ profileId: string }>;
  executable: string;
  entry: string;
}
/** Configuration contains public references only; no credential-store port exists here. */
export async function buildClientConfiguration(
  ports: ClientConfigurationPorts,
  userId: string,
  clientId: string,
): Promise<McpClientConfiguration> {
  const assertOwned = () => {
    if (
      !ports
        .list(userId)
        .some((client) => client.id === clientId && client.enabled)
    )
      throw Error("MCP_CLIENT_NOT_FOUND");
  };
  assertOwned();
  const { profileId } = await ports.start();
  assertOwned();
  return {
    command: ports.executable,
    args: [ports.entry, "--profile", profileId, "--client", clientId],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
