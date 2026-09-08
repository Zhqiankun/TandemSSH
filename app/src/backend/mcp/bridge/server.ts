import { createServer, type Socket, type Server } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseCoreRequest, type CoreMethod } from "../contracts.js";
import {
  challengeSchema,
  helloSchema,
  proofSchema,
  mac,
  verifyMac,
  seal,
  unseal,
  send,
  receive,
  publicError,
  type HandshakeContext,
} from "./protocol.js";
export interface BridgeClientIdentity {
  clientId: string;
  userId: string;
  allowedHostIds: number[];
  readTerminal: boolean;
}
export interface BridgePrincipal extends BridgeClientIdentity {
  connectionId: string;
}
export interface BridgeServerPorts {
  profileId: string;
  authenticate(
    clientId: string,
  ): Promise<{ identity: BridgeClientIdentity; secret: Uint8Array } | null>;
  isAllowed(principal: BridgePrincipal): boolean;
  connected(principal: BridgePrincipal): void;
  disconnected(principal: BridgePrincipal): void;
  invoke(
    principal: BridgePrincipal,
    method: CoreMethod,
    parameters: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
const requestSchema = z
  .object({
    id: z.number().int().positive(),
    method: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
/** Authenticated local IPC. Identity comes from the registry; every request is
 * signed with a direction-specific sequence, fresh challenge and connection ID. */
export class LocalBridgeServer {
  private server?: Server;
  private readonly sockets = new Map<Socket, BridgePrincipal | undefined>();
  private readonly dropped = new WeakSet<Socket>();
  private drop(socket: Socket, principal?: BridgePrincipal): void {
    if (principal && !this.dropped.has(socket)) {
      this.dropped.add(socket);
      this.ports.disconnected(principal);
    }
  }
  constructor(private readonly ports: BridgeServerPorts) {}
  async listen(endpoint: string): Promise<void> {
    if (this.server) throw new Error("MCP_ALREADY_STARTED");
    this.server = createServer((socket) => {
      this.sockets.set(socket, undefined);
      void this.serve(socket);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(endpoint, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    this.server.on("error", () => {});
  }
  disconnect(clientId: string): void {
    for (const [socket, principal] of this.sockets)
      if (principal?.clientId === clientId) {
        this.drop(socket, principal);
        socket.destroy();
      }
  }
  async close(): Promise<void> {
    for (const [socket, principal] of this.sockets) {
      this.drop(socket, principal);
      socket.destroy();
    }
    if (this.server?.listening)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
  private async serve(socket: Socket): Promise<void> {
    let principal: BridgePrincipal | undefined;
    let secret: Uint8Array | undefined;
    const abort = new AbortController();
    socket.on("error", () => {});
    socket.once("close", () => {
      abort.abort();
      this.drop(socket, principal);
    });
    socket.setTimeout(10000, () => socket.destroy());
    try {
      const incoming = receive(socket);
      const hello = helloSchema.parse((await incoming.next()).value);
      if (hello.profileId !== this.ports.profileId)
        throw new Error("MCP_PAIRING_NOT_FOUND");
      const authenticated = await this.ports.authenticate(hello.clientId);
      if (!authenticated || abort.signal.aborted)
        throw new Error("MCP_PAIRING_NOT_FOUND");
      if (authenticated.identity.clientId !== hello.clientId)
        throw new Error("MCP_PAIRING_FAILED");
      secret = Uint8Array.from(authenticated.secret);
      if (secret.byteLength !== 32) throw new Error("INVALID_PAIRING_SECRET");
      const context: HandshakeContext = {
        ...hello,
        serverNonce: randomBytes(32).toString("hex"),
        connectionId: randomUUID(),
      };
      send(
        socket,
        challengeSchema.parse({
          kind: "challenge",
          connectionId: context.connectionId,
          serverNonce: context.serverNonce,
          mac: mac(secret, context, "server-challenge", null),
        }),
      );
      const proof = proofSchema.parse((await incoming.next()).value);
      if (!verifyMac(proof.mac, mac(secret, context, "client-proof", null)))
        throw new Error("MCP_PAIRING_FAILED");
      principal = {
        ...structuredClone(authenticated.identity),
        connectionId: context.connectionId,
      };
      if (abort.signal.aborted || !this.ports.isAllowed(principal))
        throw new Error("MCP_PAIRING_REVOKED");
      this.sockets.set(socket, principal);
      this.ports.connected(principal);
      socket.setTimeout(0);
      let sent = 1,
        received = 0,
        inFlight = 0;
      const requestIds = new Set<number>();
      send(
        socket,
        seal(secret, context, "server", sent, {
          kind: "ready",
          connectionId: context.connectionId,
        }),
      );
      for await (const raw of incoming) {
        const message = requestSchema.parse(
          unseal(secret, context, "client", ++received, raw),
        );
        if (
          requestIds.has(message.id) ||
          inFlight >= 16 ||
          requestIds.size >= 10000
        )
          throw new Error("MCP_REQUEST_LIMIT");
        requestIds.add(message.id);
        if (!this.ports.isAllowed(principal))
          throw new Error("MCP_PAIRING_REVOKED");
        const request = parseCoreRequest(message.method, message.parameters);
        inFlight++;
        const identity = principal;
        const signingSecret = secret;
        void Promise.resolve()
          .then(() =>
            this.ports.invoke(
              identity,
              request.method,
              request.parameters,
              abort.signal,
            ),
          )
          .then(
            (result) => ({ id: message.id, result }),
            (error) => ({ id: message.id, error: publicError(error) }),
          )
          .then((response) => {
            if (abort.signal.aborted) return;
            if (!this.ports.isAllowed(identity)) {
              socket.destroy();
              return;
            }
            send(
              socket,
              seal(signingSecret, context, "server", ++sent, response),
            );
          })
          .catch(() => socket.destroy())
          .finally(() => inFlight--);
      }
    } catch {
      /* Do not disclose pairing membership, tokens or internal exceptions to unauthenticated peers. */
    } finally {
      abort.abort();
      socket.destroy();
      this.sockets.delete(socket);
      this.drop(socket, principal);
      secret?.fill(0);
    }
  }
}
