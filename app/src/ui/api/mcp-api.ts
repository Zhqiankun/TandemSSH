import { authApi } from "@/main-axios";
import type {
  McpClientConfiguration,
  McpPairing,
  McpPairingStatus,
} from "@/types/mcp-pairing";
export interface McpHost {
  id: number;
  name: string;
  address: string;
  port: number;
}
export interface McpSessionRequest {
  id: string;
  hostId: number;
  state: "pending" | "opening" | "failed";
  createdAt: number;
}
export const mcpApi = {
  async status() {
    return (await authApi.get<McpPairingStatus>("/tandem/mcp")).data;
  },
  async hosts() {
    return (await authApi.get<{ hosts: McpHost[] }>("/tandem/mcp/hosts")).data
      .hosts;
  },
  async create(input: {
    name: string;
    allowedHostIds: number[];
    readTerminal: boolean;
  }) {
    return (
      await authApi.post<{
        client: McpPairing;
        configuration: McpClientConfiguration;
      }>("/tandem/mcp/clients", input)
    ).data;
  },
  async configuration(clientId: string) {
    return (
      await authApi.get<McpClientConfiguration>(
        "/tandem/mcp/clients/" + clientId + "/configuration",
      )
    ).data;
  },
  async revoke(clientId: string) {
    await authApi.delete("/tandem/mcp/clients/" + clientId);
  },
  async requests(signal?: AbortSignal) {
    return (
      await authApi.get<{ requests: McpSessionRequest[] }>(
        "/tandem/mcp/connection-requests",
        { signal },
      )
    ).data.requests;
  },
  async claim(id: string, consumerId: string) {
    return (
      await authApi.post<McpSessionRequest>(
        "/tandem/mcp/connection-requests/" + id + "/claim",
        { consumerId },
      )
    ).data;
  },
  async fail(id: string) {
    await authApi.post("/tandem/mcp/connection-requests/" + id + "/fail");
  },
};
export function codexMcpConfiguration(
  configuration: McpClientConfiguration,
): string {
  const quote = (value: string) => JSON.stringify(value);
  return (
    "[mcp_servers.tandemssh]\ncommand = " +
    quote(configuration.command) +
    "\nargs = [" +
    configuration.args.map(quote).join(", ") +
    "]\nstartup_timeout_sec = 15\ntool_timeout_sec = 45\n\n[mcp_servers.tandemssh.env]\n" +
    Object.entries(configuration.env)
      .map(([key, value]) => quote(key) + " = " + quote(value))
      .join("\n") +
    "\n"
  );
}
