import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LocalBridgeServer } from "../../mcp/bridge/server";
import { localBridgeEndpoint } from "../../mcp/bridge/endpoint";
import { SystemPairingSecretStore } from "../../mcp/credential-store";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
const appRoot = fileURLToPath(new URL("../../../../", import.meta.url)),
  entry =
    process.env.TANDEM_TEST_MCP_ENTRY ??
    path.join(appRoot, "dist/backend/backend/mcp/stdio.js");
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
describe.runIf(
  process.platform === "win32" &&
    (!!process.env.TANDEM_TEST_MCP_ENTRY || fs.existsSync(entry)),
)("real stdio binary transfers with OS pairing", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode carries authorized files through the signed pipe and SFTP",
    async (mode) => {
      expect(fs.existsSync(entry)).toBe(true);
      const f = await transferToolsFixture();
      cleanup.push(f.close);
      const profileId = randomUUID(),
        clientId = f.principal.clientId,
        reference = { profileId, clientId },
        secret = randomBytes(32),
        credentials = new SystemPairingSecretStore();
      await credentials.write(reference, secret);
      cleanup.push(() => credentials.remove(reference));
      const server = new LocalBridgeServer({
        profileId,
        authenticate: async (id) =>
          id === clientId
            ? {
                secret,
                identity: {
                  clientId,
                  userId: "owner",
                  allowedHostIds: [7],
                  readTerminal: false,
                },
              }
            : null,
        isAllowed: () => true,
        connected: (p) => f.runtime.connectClient(p.connectionId),
        disconnected: (p) => f.runtime.disconnectClient(p.connectionId),
        invoke: (...args) => f.core.invoke(...args),
      });
      await server.listen(localBridgeEndpoint(profileId));
      cleanup.push(() => server.close());
      const transport = new StdioClientTransport({
        command: process.env.TANDEM_TEST_MCP_EXECUTABLE ?? process.execPath,
        env: process.env.TANDEM_TEST_MCP_EXECUTABLE
          ? { ELECTRON_RUN_AS_NODE: "1" }
          : undefined,
        args: [entry, "--profile", profileId, "--client", clientId],
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (data) => {
        stderr = (stderr + String(data)).slice(-4000);
      });
      const client = new Client({
        name: "codex-binary-transfer-acceptance",
        version: "1",
      });
      await client.connect(transport);
      cleanup.push(() => client.close());
      expect((await client.listTools()).tools).toHaveLength(29);
      const call = async (
        name: string,
        arguments_: Record<string, unknown>,
      ) => {
        const r = await client.callTool({ name, arguments: arguments_ });
        expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
        return r.structuredContent!.result as Record<string, unknown>;
      };
      const task = await call("start_task", {
          sessionId: f.sessionId,
          requestId: randomUUID(),
          goal: "已授权二进制传输验收",
          mode,
        }),
        taskId = task.id as string;
      await f.select(taskId);
      const listed = await call("list_authorized_files", { taskId });
      expect(JSON.stringify(listed)).not.toContain(f.folder);
      await f.authorize(taskId);
      for (const direction of ["upload", "download"] as const) {
        const grant = (
          listed.files as Array<{
            id: string;
            version: string;
            direction: string;
          }>
        ).find((g) => g.direction === direction)!;
        const submitted = await call(direction + "_file", {
            taskId,
            requestId: randomUUID(),
            path: "/srv/binary.bin",
            localGrantId: grant.id,
            localVersion: grant.version,
          }),
          operationId = submitted.operationId as string;
        if (mode === "collaborative") {
          await vi.waitFor(() =>
            expect(
              f.runtime.operation(f.human, taskId, operationId).status,
            ).toBe("awaiting-approval"),
          );
          const op = f.runtime.operation(f.human, taskId, operationId);
          await f.runtime.approve(f.human, taskId, op.id, op.digest, 1);
        }
        await vi.waitFor(
          () =>
            expect(
              f.runtime.operation(f.human, taskId, operationId).status,
            ).toBe("succeeded"),
          { timeout: 10000 },
        );
        const result = await call("get_transfer_status", {
          taskId,
          operationId,
        });
        expect(
          (result.fileResult as { transfer: { verification: string } }).transfer
            .verification,
        ).toBe("sha256");
        await call("release_transfer", { taskId, operationId });
      }
      expect(await f.remote.read("/srv/binary.bin")).toEqual(f.bytes);
      expect(await fsp.readFile(f.destination)).toEqual(f.bytes);
      expect(f.writes).toEqual(["context"]);
      expect(stderr).not.toContain(f.folder);
      await client.close();
      await vi.waitFor(() =>
        expect(f.runtime.get(f.human, taskId).state).toBe("cancelled"),
      );
    },
    30000,
  );
});
