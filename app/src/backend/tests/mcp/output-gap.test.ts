import { expect, it, vi } from "vitest";
import { McpCore, type McpCorePorts } from "../../mcp/core.js";
import type { BridgePrincipal } from "../../mcp/bridge/server.js";
const principal = {
  clientId: "client",
  connectionId: "connection",
  userId: "owner",
  allowedHostIds: [1],
  readTerminal: true,
} as BridgePrincipal;
it("marks an already-truncated history snapshot even on the first MCP read", async () => {
  const output = vi.fn(() => ({
    text: "recent output",
    cursor: 30,
    firstCursor: 20,
    generation: 2,
    truncated: true,
  }));
  const core = new McpCore({
    tasks: {} as McpCorePorts["tasks"],
    output,
    hosts: async () => [],
    sessions: () => [],
    open: async () => ({}),
  });
  const read = (params: Record<string, unknown>, actor = principal) =>
    core.invoke(
      actor,
      "sessions.output",
      { sessionId: "11111111-1111-4111-8111-111111111111", ...params },
      new AbortController().signal,
    );
  expect(await read({})).toMatchObject({
    contextGap: true,
    truncated: true,
    text: "recent output",
    contentTrust: "untrusted-terminal-output",
  });
  expect(await read({ cursor: 10 })).toMatchObject({
    contextGap: true,
    truncated: true,
  });
  expect(await read({ cursor: 30 })).toMatchObject({
    contextGap: false,
    unchanged: true,
    text: "",
  });
  await expect(read({ cursor: 31 })).rejects.toThrow("CONTEXT_GAP");
  output.mockClear();
  await expect(read({}, { ...principal, readTerminal: false })).rejects.toThrow(
    "MCP_TERMINAL_READ_DENIED",
  );
  expect(output).not.toHaveBeenCalled();
});
