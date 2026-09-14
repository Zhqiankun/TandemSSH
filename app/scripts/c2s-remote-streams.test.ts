import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { C2S_REMOTE_STREAM_LIMIT as backendLimit } from "../src/backend/hosts/tunnel/c2s-admission.js";
const { C2S_REMOTE_STREAM_LIMIT, remoteStreamAdmission } = createRequire(import.meta.url)("../electron/c2s-remote-streams.cjs");
it("keeps duplicate IDs from replacing a live socket and reuses released capacity", () => {
  expect(C2S_REMOTE_STREAM_LIMIT).toBe(32); expect(backendLimit).toBe(32);
  const streams = new Map(Array.from({length: 32}, (_, i) => [String(i), { id: i }]));
  const original = streams.get("0");
  expect(remoteStreamAdmission(streams, "0")).toBe("duplicate");
  expect(streams.get("0")).toBe(original);
  expect(remoteStreamAdmission(streams, "new")).toBe("full");
  streams.delete("1");
  expect(remoteStreamAdmission(streams, "new")).toBe("allowed");
});
