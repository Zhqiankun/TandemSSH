import { expect, it } from "vitest";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { sealRecord, openRecord } from "../../privacy/encrypted-record-codec";
const key = Buffer.alloc(32, 19),
  iv = Buffer.alloc(12, 31),
  text = '{"content":"旧草稿 PASSWORD=test-only"}',
  aad = "TandemSSH draft v1:fixture";
it("reads the pre-extraction TDF1 format and remains readable by the old decoder", () => {
  const old = createCipheriv("aes-256-gcm", key, iv);
  old.setAAD(Buffer.from(aad));
  const body = Buffer.concat([old.update(text, "utf8"), old.final()]),
    legacy = Buffer.concat([Buffer.from("TDF1"), iv, old.getAuthTag(), body]);
  expect(openRecord(legacy, key, "TDF1", aad)).toBe(text);
  const next = sealRecord(text, key, "TDF1", aad),
    reader = createDecipheriv("aes-256-gcm", key, next.subarray(4, 16));
  reader.setAAD(Buffer.from(aad));
  reader.setAuthTag(next.subarray(16, 32));
  expect(
    Buffer.concat([
      reader.update(next.subarray(32)),
      reader.final(),
    ]).toString(),
  ).toBe(text);
});
it("rejects another record namespace, key, header and modified ciphertext", () => {
  const bytes = sealRecord(text, key, "TUR1", "upload:one");
  expect(() => openRecord(bytes, key, "TUR1", "upload:two")).toThrow();
  expect(() =>
    openRecord(bytes, Buffer.alloc(32, 7), "TUR1", "upload:one"),
  ).toThrow();
  expect(() => openRecord(bytes, key, "TDF1", "upload:one")).toThrow();
  bytes[bytes.length - 1] ^= 1;
  expect(() => openRecord(bytes, key, "TUR1", "upload:one")).toThrow();
});
