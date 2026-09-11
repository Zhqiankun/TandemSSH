import { types } from "node:util";
import { createHash } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "TandemSSH Workflow Secrets";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const MAX_WORKFLOW_SECRET_BYTES = 2048;
export interface WorkflowSecretReference {
  profileId: string;
  userId: string;
  secretId: string;
}
function account(reference: WorkflowSecretReference): string {
  if (
    !UUID.test(reference.profileId) ||
    !UUID.test(reference.secretId) ||
    typeof reference.userId !== "string" ||
    !reference.userId.length ||
    reference.userId.length > 128 ||
    /[\x00-\x20\x7f]/.test(reference.userId)
  )
    throw Error("INVALID_WORKFLOW_SECRET_REFERENCE");
  return createHash("sha256")
    .update(
      JSON.stringify([
        reference.profileId,
        reference.userId,
        reference.secretId,
      ]),
    )
    .digest("hex");
}
function validSecret(secret: Uint8Array): boolean {
  return (
    types.isUint8Array(secret) &&
    secret.byteLength > 0 &&
    secret.byteLength <= MAX_WORKFLOW_SECRET_BYTES
  );
}
/** Storage adapter only. The workflow use case must authorize the reference
 * and its intended operation before invoking it. Never expose use() as a route
 * or model tool. No plaintext file or environment fallback is permitted. */
export class SystemWorkflowSecretStore {
  async write(
    reference: WorkflowSecretReference,
    secret: Uint8Array,
  ): Promise<void> {
    const entry = new AsyncEntry(SERVICE, account(reference));
    if (!validSecret(secret)) throw Error("INVALID_WORKFLOW_SECRET");
    const copy = Uint8Array.from(secret);
    try {
      await entry.setSecret(copy);
    } catch {
      throw Error("WORKFLOW_SECRET_STORE_UNAVAILABLE");
    } finally {
      copy.fill(0);
    }
  }
  async use(
    reference: WorkflowSecretReference,
    consume: (secret: Uint8Array) => Promise<void>,
  ): Promise<void> {
    const entry = new AsyncEntry(SERVICE, account(reference));
    let raw: Uint8Array | number[] | undefined;
    try {
      raw = (await entry.getSecret()) as Uint8Array | number[] | undefined;
    } catch {
      throw Error("WORKFLOW_SECRET_STORE_UNAVAILABLE");
    }
    if (!raw) throw Error("WORKFLOW_SECRET_NOT_FOUND");
    let secret: Uint8Array | undefined;
    try {
      // keyring 2.0.0 currently returns number[] on Windows despite its typings.
      if (Array.isArray(raw)) {
        if (
          !raw.length ||
          raw.length > MAX_WORKFLOW_SECRET_BYTES ||
          !raw.every(
            (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
          )
        )
          throw Error("INVALID_WORKFLOW_SECRET");
        secret = Uint8Array.from(raw);
      } else secret = raw;
      if (!validSecret(secret)) throw Error("INVALID_WORKFLOW_SECRET");
      await consume(secret);
    } finally {
      secret?.fill(0);
      raw.fill(0);
    }
  }
  async remove(reference: WorkflowSecretReference): Promise<boolean> {
    const entry = new AsyncEntry(SERVICE, account(reference));
    try {
      return await entry.deleteCredential();
    } catch {
      throw Error("WORKFLOW_SECRET_STORE_UNAVAILABLE");
    }
  }
}
