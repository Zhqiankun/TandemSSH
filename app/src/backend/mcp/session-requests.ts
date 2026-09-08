import { randomUUID } from "node:crypto";
import type { BridgePrincipal } from "./bridge/server.js";
export interface DesktopSessionRequest {
  id: string;
  hostId: number;
  createdAt: number;
  state: "pending" | "opening" | "failed";
  error?: string;
}
interface StoredRequest extends DesktopSessionRequest {
  principal: BridgePrincipal;
  requestId: string;
  consumerId?: string;
}
export interface SessionRequestPorts {
  connected(
    principal: BridgePrincipal,
    hostId: number,
    instanceId?: string,
  ): { id: string; control: unknown } | undefined;
  allowed(principal: BridgePrincipal): boolean;
}
/** Desktop owns SSH connection creation so fingerprints, auth challenges and
 * the actual terminal tab continue to use the existing interactive path. */
export class DesktopSessionRequests {
  private readonly requests = new Map<string, StoredRequest>();
  constructor(private readonly ports: SessionRequestPorts) {}
  private valid(request: StoredRequest): boolean {
    return (
      Date.now() - request.createdAt < 5 * 60_000 &&
      this.ports.allowed(request.principal)
    );
  }
  open(principal: BridgePrincipal, hostId: number, requestId: string): unknown {
    if (
      !this.ports.allowed(principal) ||
      !principal.allowedHostIds.includes(hostId)
    )
      throw new Error("HOST_NOT_FOUND");
    const key = JSON.stringify([principal.connectionId, requestId]);
    const previous = this.requests.get(key);
    if (previous) {
      if (previous.hostId !== hostId) throw new Error("REQUEST_CONFLICT");
      if (!this.valid(previous))
        throw new Error("MCP_CONNECTION_REQUEST_EXPIRED");
      const session = this.ports.connected(principal, hostId, previous.id);
      return session
        ? {
            state: "connected",
            sessionId: session.id,
            control: session.control,
          }
        : this.public(previous);
    }
    const existing = this.ports.connected(principal, hostId);
    if (existing)
      return {
        state: "connected",
        sessionId: existing.id,
        control: existing.control,
      };
    for (const [id, request] of this.requests)
      if (!this.valid(request)) this.requests.delete(id);
    if (this.requests.size >= 128) throw new Error("MCP_REQUEST_LIMIT");
    const request: StoredRequest = {
      id: randomUUID(),
      hostId,
      requestId,
      principal: structuredClone(principal),
      createdAt: Date.now(),
      state: "pending",
    };
    this.requests.set(key, request);
    return this.public(request);
  }
  list(userId: string): DesktopSessionRequest[] {
    return [...this.requests.values()]
      .filter(
        (request) =>
          request.principal.userId === userId &&
          request.state !== "failed" &&
          this.valid(request) &&
          !this.ports.connected(request.principal, request.hostId, request.id),
      )
      .map((request) => this.public(request));
  }
  claim(userId: string, id: string, consumerId: string): DesktopSessionRequest {
    const request = [...this.requests.values()].find(
      (item) => item.id === id && item.principal.userId === userId,
    );
    if (!request || !this.valid(request))
      throw new Error("MCP_CONNECTION_REQUEST_EXPIRED");
    if (request.consumerId && request.consumerId !== consumerId)
      throw new Error("MCP_CONNECTION_REQUEST_CLAIMED");
    request.consumerId = consumerId;
    request.state = "opening";
    return this.public(request);
  }
  fail(userId: string, id: string): void {
    const request = [...this.requests.values()].find(
      (item) => item.id === id && item.principal.userId === userId,
    );
    if (request) {
      request.state = "failed";
      request.error = "DESKTOP_CONNECTION_FAILED";
    }
  }
  private public(request: StoredRequest): DesktopSessionRequest {
    return {
      id: request.id,
      hostId: request.hostId,
      createdAt: request.createdAt,
      state: request.state,
      error: request.error,
    };
  }
}
