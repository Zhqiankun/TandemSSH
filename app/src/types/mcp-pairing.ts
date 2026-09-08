export interface McpPairing {
  id: string;
  name: string;
  allowedHostIds: number[];
  readTerminal: boolean;
  createdAt: number;
  enabled: boolean;
}
export interface McpClientConfiguration {
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface McpPairingStatus {
  profileId: string;
  running: boolean;
  clients: McpPairing[];
}
