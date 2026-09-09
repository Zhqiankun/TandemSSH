import { AsyncEntry } from "@napi-rs/keyring";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { DraftKeyPort } from "./store.js";
/** Draft-only keys in the current OS user's credential store; no disk-key fallback. */
export class SystemDraftKey implements DraftKeyPort {
  private profile: string;
  constructor(root: string) {
    const resolved = path.resolve(root);
    this.profile =
      process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
  async load(userId: string, create: boolean): Promise<Buffer | null> {
    const account = createHash("sha256")
      .update(JSON.stringify([this.profile, userId]))
      .digest("hex");
    const entry = new AsyncEntry("TandemSSH file drafts", account);
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
      throw Error("FILE_DRAFT_KEY_FAILED");
    return key;
  }
}
