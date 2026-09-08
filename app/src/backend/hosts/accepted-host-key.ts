import { createHash } from "node:crypto";
const accepted = new WeakMap<object, string>();
type Verifier = (key: Buffer, done: (valid: boolean) => void) => void;
/** Records the key accepted by the existing verifier. This helper makes no trust decision. */
export function captureAcceptedHostKey(
  client: object,
  verifier: Verifier,
): Verifier {
  return (key, done) => {
    const fingerprint =
      "SHA256:" +
      createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
    verifier(key, (valid) => {
      if (valid) accepted.set(client, fingerprint);
      done(valid);
    });
  };
}
export const acceptedHostKeyFor = (client: object) => accepted.get(client);
