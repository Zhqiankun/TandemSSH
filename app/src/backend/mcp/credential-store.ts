import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "TandemSSH MCP";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface PairingReference {
  profileId: string;
  clientId: string;
}
export interface PairingSecretStore {
  read(reference: PairingReference): Promise<Uint8Array>;
  write(reference: PairingReference, secret: Uint8Array): Promise<void>;
  remove(reference: PairingReference): Promise<boolean>;
}

function account(reference: PairingReference): string {
  if (!UUID.test(reference.profileId) || !UUID.test(reference.clientId))
    throw new Error("INVALID_PAIRING_REFERENCE");
  return `${reference.profileId}/${reference.clientId}`;
}

/** The desktop and stdio client use the current OS user's credential store.
 * There is deliberately no JSON, environment-variable or plaintext fallback. */
export class SystemPairingSecretStore implements PairingSecretStore {
  async read(reference: PairingReference): Promise<Uint8Array> {
    const entry = new AsyncEntry(SERVICE, account(reference));
    let secret: Uint8Array | undefined;
    try {
      secret = await entry.getSecret();
    } catch {
      throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
    }
    if (!secret) throw new Error("MCP_PAIRING_NOT_FOUND");
    return secret;
  }
  async write(reference: PairingReference, secret: Uint8Array): Promise<void> {
    if (secret.byteLength !== 32) throw new Error("INVALID_PAIRING_SECRET");
    const entry = new AsyncEntry(SERVICE, account(reference));
    try {
      await entry.setSecret(secret);
    } catch {
      throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
  async remove(reference: PairingReference): Promise<boolean> {
    const entry = new AsyncEntry(SERVICE, account(reference));
    try {
      return await entry.deleteCredential();
    } catch {
      throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
}
