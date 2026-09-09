import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
/** Stable AEAD framing only. Callers own payload schemas, storage quotas and authorization. */
export function sealRecord(
  text: string,
  key: Buffer,
  header: string,
  aad: string,
): Buffer {
  if (Buffer.byteLength(header) !== 4 || key.length !== 32)
    throw Error("LOCAL_RECORD_FORMAT_INVALID");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from(header),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}
export function openRecord(
  bytes: Buffer,
  key: Buffer,
  header: string,
  aad: string,
): string {
  if (
    Buffer.byteLength(header) !== 4 ||
    key.length !== 32 ||
    bytes.length < 32 ||
    bytes.subarray(0, 4).toString() !== header
  )
    throw Error("LOCAL_RECORD_FORMAT_INVALID");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16));
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([
    cipher.update(bytes.subarray(32)),
    cipher.final(),
  ]).toString("utf8");
}
