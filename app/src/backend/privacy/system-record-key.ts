import { AsyncEntry } from "@napi-rs/keyring";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
/** Per-profile, per-user keys in a caller-owned OS service namespace. No disk-key fallback. */
export class SystemRecordKey {
  private profile: string;
  constructor(
    root: string,
    private service: string,
    private failureCode = "LOCAL_RECORD_KEY_FAILED",
  ) {
    const resolved = path.resolve(root);
    this.profile =
      process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
  async load(userId: string, create: boolean): Promise<Buffer | null> {
    const account = createHash("sha256")
      .update(JSON.stringify([this.profile, userId]))
      .digest("hex");
    const entry = new AsyncEntry(this.service, account);
    const existing = await entry.getSecret();
    if (existing) return Buffer.from(existing);
    if (!create) return null;
    const key = randomBytes(32);
    await entry.setSecret(key);
    const stored = await entry.getSecret();
    if (
      !stored ||
      stored.length !== 32 ||
      !timingSafeEqual(key, Buffer.from(stored))
    )
      throw Error(this.failureCode);
    return key;
  }
}
