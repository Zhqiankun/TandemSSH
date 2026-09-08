import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  PairingReference,
  PairingSecretStore,
} from "../credential-store.js";
import {
  parseCoreRequest,
  type CoreBridgePort,
  type CoreMethod,
} from "../contracts.js";
import {
  challengeSchema,
  mac,
  verifyMac,
  seal,
  unseal,
  send,
  receive,
  type HandshakeContext,
} from "./protocol.js";
const responseSchema = z
  .object({
    id: z.number().int().positive(),
    result: z.unknown().optional(),
    error: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,80}$/)
      .optional(),
  })
  .strict();
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}
export class LocalBridgeClient implements CoreBridgePort {
  private outgoing = 0;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private constructor(
    private readonly socket: Socket,
    private readonly secret: Uint8Array,
    private readonly context: HandshakeContext,
  ) {}
  static async connect(
    endpoint: string,
    reference: PairingReference,
    secrets: PairingSecretStore,
  ): Promise<LocalBridgeClient> {
    const secret = Uint8Array.from(await secrets.read(reference));
    if (secret.byteLength !== 32) throw new Error("INVALID_PAIRING_SECRET");
    const socket = createConnection(endpoint);
    socket.on("error", () => {});
    const timer = setTimeout(() => socket.destroy(), 10000);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", () => reject(new Error("DESKTOP_NOT_RUNNING")));
        socket.once("close", () => reject(new Error("MCP_DISCONNECTED")));
      });
      const clientNonce = randomBytes(32).toString("hex");
      const incoming = receive(socket);
      send(socket, { kind: "hello", ...reference, clientNonce });
      const challenge = challengeSchema.parse((await incoming.next()).value);
      const context = {
        ...reference,
        clientNonce,
        serverNonce: challenge.serverNonce,
        connectionId: challenge.connectionId,
      };
      if (
        !verifyMac(
          challenge.mac,
          mac(secret, context, "server-challenge", null),
        )
      )
        throw new Error("MCP_PAIRING_FAILED");
      send(socket, {
        kind: "proof",
        mac: mac(secret, context, "client-proof", null),
      });
      const ready = z
        .object({
          kind: z.literal("ready"),
          connectionId: z.literal(context.connectionId),
        })
        .strict()
        .parse(
          unseal(secret, context, "server", 1, (await incoming.next()).value),
        );
      if (!ready) throw new Error("MCP_PAIRING_FAILED");
      clearTimeout(timer);
      const client = new LocalBridgeClient(socket, secret, context);
      void client.read(incoming);
      return client;
    } catch (error) {
      clearTimeout(timer);
      socket.destroy();
      secret.fill(0);
      throw error;
    }
  }
  invoke(
    method: CoreMethod,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed || signal?.aborted)
      return Promise.reject(new Error("MCP_DISCONNECTED"));
    const request = parseCoreRequest(method, parameters);
    if (this.pending.size >= 16)
      return Promise.reject(new Error("MCP_REQUEST_LIMIT"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => this.close();
      const timer = setTimeout(() => this.close(), 30000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        send(
          this.socket,
          seal(this.secret, this.context, "client", ++this.outgoing, {
            id,
            ...request,
          }),
        );
      } catch (error) {
        cleanup();
        this.pending.delete(id);
        reject(error);
        this.close();
      }
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error("MCP_DISCONNECTED"));
    }
    this.pending.clear();
    this.secret.fill(0);
  }
  private async read(incoming: AsyncGenerator<unknown>): Promise<void> {
    let received = 1;
    try {
      for await (const raw of incoming) {
        const message = responseSchema.parse(
          unseal(this.secret, this.context, "server", ++received, raw),
        );
        const pending = this.pending.get(message.id);
        if (!pending) throw new Error("MCP_UNEXPECTED_RESPONSE");
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      }
    } catch {
      /* Caller sees a closed authenticated channel; never replay an uncertain request. */
    } finally {
      this.close();
    }
  }
}
