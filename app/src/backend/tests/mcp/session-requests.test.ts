import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DesktopSessionRequests } from "../../mcp/session-requests.js";
const principal = {
  clientId: randomUUID(),
  connectionId: randomUUID(),
  userId: "owner",
  allowedHostIds: [7, 8],
  readTerminal: false,
};
describe("visible desktop connection requests", () => {
  it("deduplicates an opening request and waits for the correlated real session", () => {
    let connected = false;
    const broker = new DesktopSessionRequests({
      allowed: () => true,
      connected: (_actor, _host, id) =>
        connected && id === instanceId
          ? { id: "session", control: { kind: "human" } }
          : undefined,
    });
    const first = broker.open(principal, 7, "request") as {
      id: string;
      state: string;
    };
    expect(first.state).toBe("pending");
    expect(broker.open(principal, 7, "request")).toEqual(first);
    expect(() => broker.open(principal, 8, "request")).toThrow(
      "REQUEST_CONFLICT",
    );
    const instanceId = first.id;
    broker.claim("owner", first.id, "window");
    expect(
      (broker.open(principal, 7, "request") as { state: string }).state,
    ).toBe("opening");
    connected = true;
    expect(broker.open(principal, 7, "request")).toMatchObject({
      state: "connected",
      sessionId: "session",
    });
    expect(broker.list("owner")).toEqual([]);
  });
  it("prevents another user or desktop consumer from claiming the same request", () => {
    const broker = new DesktopSessionRequests({
      allowed: () => true,
      connected: () => undefined,
    });
    const request = broker.open(principal, 7, "r") as { id: string };
    expect(broker.list("other")).toEqual([]);
    expect(() => broker.claim("other", request.id, "a")).toThrow();
    broker.claim("owner", request.id, "a");
    expect(() => broker.claim("owner", request.id, "b")).toThrow(
      "MCP_CONNECTION_REQUEST_CLAIMED",
    );
  });
  it("drops a revoked client's pending connection request", () => {
    let allowed = true;
    const broker = new DesktopSessionRequests({
      allowed: () => allowed,
      connected: () => undefined,
    });
    const request = broker.open(principal, 7, "r") as { id: string };
    allowed = false;
    expect(broker.list("owner")).toEqual([]);
    expect(() => broker.claim("owner", request.id, "a")).toThrow(
      "MCP_CONNECTION_REQUEST_EXPIRED",
    );
  });
});
