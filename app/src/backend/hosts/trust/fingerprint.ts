import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
export function hostAddress(input: string) {
  let value = input.trim();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (
    !value ||
    value.length > 512 ||
    value.includes("/") ||
    /[\s\x00-\x1f\x7f\\]/.test(value)
  )
    throw Error("HOST_TRUST_TARGET_INVALID");
  if (isIP(value) === 6) {
    const [ip, zone] = value.split("%");
    if (zone && !/^[A-Za-z0-9_.-]{1,64}$/.test(zone))
      throw Error("HOST_TRUST_TARGET_INVALID");
    return (
      new URL("http://[" + ip + "]").hostname.slice(1, -1) +
      (zone ? "%" + zone : "")
    );
  }
  if (isIP(value) === 4) return value;
  value = domainToASCII(value).toLowerCase().replace(/\.$/, "");
  if (!value || value.includes(":")) throw Error("HOST_TRUST_TARGET_INVALID");
  return value;
}
export function hostTrustId(
  userId: string,
  address: string,
  port: number,
  hostId?: number,
) {
  if (
    !userId ||
    userId.length > 256 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("HOST_TRUST_TARGET_INVALID");
  return createHash("sha256")
    .update(
      JSON.stringify([
        userId,
        hostId ? "host:" + hostId : "quick",
        hostAddress(address),
        port,
      ]),
    )
    .digest("hex");
}
export function hostFingerprint(key: Buffer) {
  if (!Buffer.isBuffer(key) || key.length < 5 || key.length > 16384)
    throw Error("HOST_KEY_INVALID");
  const length = key.readUInt32BE(0);
  if (length < 1 || length > 256 || length > key.length - 4)
    throw Error("HOST_KEY_INVALID");
  const keyType = key.toString("ascii", 4, 4 + length);
  if (!/^(ssh-|ecdsa-)[a-zA-Z0-9@._+-]+$/.test(keyType))
    throw Error("HOST_KEY_INVALID");
  return {
    keyType,
    fingerprint:
      "SHA256:" +
      createHash("sha256").update(key).digest("base64").replace(/=+$/, ""),
  };
}
export function legacyFingerprint(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  if (/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)) return value;
  if (/^(?:[a-f0-9]{2}){5,16384}$/i.test(value)) {
    try {
      return hostFingerprint(Buffer.from(value, "hex")).fingerprint;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
