import { readMcpVersion } from "./version.js";
import { parseArgs } from "node:util";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTandemMcpServer } from "./server.js";
import { SystemPairingSecretStore } from "./credential-store.js";
import { LocalBridgeClient } from "./bridge/client.js";
import { localBridgeEndpoint } from "./bridge/endpoint.js";
import { publicError } from "./bridge/protocol.js";
async function main() {
  const { values } = parseArgs({
    options: { profile: { type: "string" }, client: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  const reference = z
    .object({ profileId: z.string().uuid(), clientId: z.string().uuid() })
    .parse({ profileId: values.profile, clientId: values.client });
  const version = readMcpVersion();
  const client = await LocalBridgeClient.connect(
    localBridgeEndpoint(reference.profileId),
    reference,
    new SystemPairingSecretStore(),
  );
  const server = createTandemMcpServer(client, version);
  server.server.onclose = () => client.close();
  const shutdown = () => {
    client.close();
    void server.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.stdin.once("end", shutdown);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    client.close();
    throw error;
  }
}
main().catch((error) => {
  if (error instanceof Error && error.message === "MCP_VERSION_UNAVAILABLE") {
    process.stderr.write(
      "同舟 SSH MCP 版本信息缺失或无效，请重新构建或安装完整版本。\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    "同舟 SSH MCP 启动失败（" +
      publicError(error) +
      "）。请先启动桌面，并检查配对是否仍然有效。\n",
  );
  process.exitCode = 1;
});
