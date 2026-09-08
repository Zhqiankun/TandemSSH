import { createHmac, timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
export const MAX_FRAME_BYTES = 1024 * 1024;
const nonce = z.string().regex(/^[a-f0-9]{64}$/);
export const helloSchema = z
  .object({
    kind: z.literal("hello"),
    profileId: z.string().uuid(),
    clientId: z.string().uuid(),
    clientNonce: nonce,
  })
  .strict();
export const challengeSchema = z
  .object({
    kind: z.literal("challenge"),
    connectionId: z.string().uuid(),
    serverNonce: nonce,
    mac: nonce,
  })
  .strict();
export const proofSchema = z
  .object({ kind: z.literal("proof"), mac: nonce })
  .strict();
const frameSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    payload: z.string().max(MAX_FRAME_BYTES),
    mac: nonce,
  })
  .strict();
export interface HandshakeContext {
  profileId: string;
  clientId: string;
  clientNonce: string;
  serverNonce: string;
  connectionId: string;
}
export function mac(
  secret: Uint8Array,
  context: HandshakeContext,
  domain: string,
  payload: unknown,
): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        context.profileId,
        context.clientId,
        context.clientNonce,
        context.serverNonce,
        context.connectionId,
        domain,
        payload,
      ]),
    )
    .digest("hex");
}
export function verifyMac(actual: string, expected: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}
export function seal(
  secret: Uint8Array,
  context: HandshakeContext,
  direction: "client" | "server",
  sequence: number,
  value: unknown,
) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > MAX_FRAME_BYTES - 1024)
    throw new Error("MCP_MESSAGE_TOO_LARGE");
  return {
    sequence,
    payload,
    mac: mac(secret, context, direction, [sequence, payload]),
  };
}
export function unseal(
  secret: Uint8Array,
  context: HandshakeContext,
  direction: "client" | "server",
  expectedSequence: number,
  input: unknown,
): unknown {
  const frame = frameSchema.parse(input);
  if (
    frame.sequence !== expectedSequence ||
    !verifyMac(
      frame.mac,
      mac(secret, context, direction, [frame.sequence, frame.payload]),
    )
  )
    throw new Error("MCP_MESSAGE_AUTHENTICATION_FAILED");
  return JSON.parse(frame.payload);
}
export function send(socket: Socket, value: unknown): void {
  const line = JSON.stringify(value) + "\n";
  if (
    Buffer.byteLength(line) > MAX_FRAME_BYTES ||
    socket.writableLength > MAX_FRAME_BYTES * 2
  )
    throw new Error("MCP_MESSAGE_TOO_LARGE");
  if (socket.destroyed) throw new Error("MCP_DISCONNECTED");
  socket.write(line);
}
export async function* receive(socket: Socket): AsyncGenerator<unknown> {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  for await (const chunk of socket) {
    buffer += decoder.write(chunk as Buffer);
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES)
        throw new Error("MCP_MESSAGE_TOO_LARGE");
      yield JSON.parse(line);
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES)
      throw new Error("MCP_MESSAGE_TOO_LARGE");
  }
  if (buffer.length) throw new Error("MCP_INCOMPLETE_MESSAGE");
}
export function publicError(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
    ? error.message
    : "CORE_REQUEST_FAILED";
}
