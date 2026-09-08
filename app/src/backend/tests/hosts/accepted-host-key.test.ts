import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  captureAcceptedHostKey,
  acceptedHostKeyFor,
} from "../../hosts/accepted-host-key";
it("records only accepted key material and keeps the captured bytes stable while verification waits", () => {
  const client = {},
    key = Buffer.from("server-key");
  let decide!: (ok: boolean) => void;
  let verdict: unknown;
  const expected =
    "SHA256:" +
    createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  captureAcceptedHostKey(client, (_key, done) => {
    decide = done;
  })(key, (valid) => {
    verdict = valid;
  });
  expect(acceptedHostKeyFor(client)).toBeUndefined();
  key.fill(0);
  decide(true);
  expect(verdict).toBe(true);
  expect(acceptedHostKeyFor(client)).toBe(expected);
  captureAcceptedHostKey(client, (_key, done) => done(false))(
    Buffer.from("other"),
    (valid) => {
      verdict = valid;
    },
  );
  expect(verdict).toBe(false);
  expect(acceptedHostKeyFor(client)).toBe(expected);
});
