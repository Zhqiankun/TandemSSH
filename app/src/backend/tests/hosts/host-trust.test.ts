import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { HostTrustService } from "../../hosts/trust/service";
import {
  hostAddress,
  hostFingerprint,
  hostTrustId,
  legacyFingerprint,
} from "../../hosts/trust/fingerprint";
import type {
  HostTrustRecord,
  HostTrustRequest,
} from "../../../types/host-trust";
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
function key(fill = 1) {
  const type = Buffer.from("ssh-ed25519"),
    length = Buffer.alloc(4);
  length.writeUInt32BE(type.length);
  return Buffer.concat([length, type, Buffer.alloc(32, fill)]);
}
const target = {
  userId: "alice",
  address: "Example.test",
  port: 22,
  isJumpHost: false,
};
function fixture() {
  const rows = new Map<string, HostTrustRecord>(),
    audit = vi.fn(async () => {}),
    write = vi.fn(async (record: HostTrustRecord, revision: number) => {
      if ((rows.get(record.id)?.revision ?? 0) !== revision)
        throw Error("HOST_TRUST_RECORD_CHANGED");
      rows.set(record.id, { ...record });
    }),
    service = new HostTrustService({
      store: {
        get: async (id, userId) => {
          const r = rows.get(id);
          return r?.userId === userId ? { ...r } : undefined;
        },
        compareAndSet: write,
      },
      audit,
    });
  cleanup.push(() => service.dispose());
  return { rows, write, audit, service };
}
const choice = (p: HostTrustRequest, action: "trust" | "reject" = "trust") => ({
  requestId: p.id,
  fingerprint: p.fingerprint,
  expectedRevision: p.expectedRevision,
  action,
  verified: action === "trust",
});
async function request(f: ReturnType<typeof fixture>) {
  await vi.waitFor(() =>
    expect(f.service.list("alice").requests.length).toBeGreaterThan(0),
  );
  return f.service.list("alice").requests[0];
}
describe("user and profile scoped host trust", () => {
  it("computes OpenSSH SHA-256 and recognizes legacy raw-key hex without trusting it", () => {
    const k = key(),
      fp = hostFingerprint(k);
    expect(fp).toEqual({
      keyType: "ssh-ed25519",
      fingerprint:
        "SHA256:" +
        createHash("sha256").update(k).digest("base64").replace(/=+$/, ""),
    });
    expect(legacyFingerprint(k.toString("hex"))).toBe(fp.fingerprint);
    expect(hostAddress("[2001:0db8:0:0::1]")).toBe("2001:db8::1");
    expect(hostTrustId("alice", "EXAMPLE.test.", 22, 1)).toBe(
      hostTrustId("alice", "example.test", 22, 1),
    );
    expect(hostTrustId("alice", "example.test", 22, 1)).not.toBe(
      hostTrustId("alice", "example.test", 22, 2),
    );
  });
  it.each([false, true])(
    "requires explicit confirmation with no WebSocket, including jump=%s",
    async (isJumpHost) => {
      const f = fixture();
      let settled = false;
      const result = f.service
        .verify({ ...target, isJumpHost }, key())
        .then((ok) => {
          settled = true;
          return ok;
        });
      const p = await request(f);
      expect(p.scenario).toBe("new");
      expect(settled).toBe(false);
      expect(f.rows.size).toBe(0);
      expect(f.service.list("bob").requests).toEqual([]);
      await expect(f.service.decide("bob", choice(p))).rejects.toThrow(
        "HOST_TRUST_REQUEST_NOT_FOUND",
      );
      await expect(
        f.service.decide("alice", { ...choice(p), verified: false }),
      ).rejects.toThrow("HOST_TRUST_VERIFICATION_REQUIRED");
      const saved = await f.service.decide("alice", choice(p));
      expect(saved.reconnectRequired).toBe(false);
      expect(await result).toBe(true);
      expect(await f.service.verify({ ...target, isJumpHost }, key())).toBe(
        true,
      );
      expect(await f.service.decide("alice", choice(p))).toEqual(saved);
      expect(f.write).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects changed keys before any approval and requires a new verification after updating trust", async () => {
    const f = fixture(),
      first = f.service.verify(target, key());
    const p = await request(f);
    await f.service.decide("alice", choice(p));
    expect(await first).toBe(true);
    expect(await f.service.verify(target, key(2))).toBe(false);
    const changed = await request(f);
    expect(changed).toMatchObject({
      scenario: "changed",
      connectionStopped: true,
      oldFingerprint: p.fingerprint,
    });
    await expect(
      f.service.decide("alice", {
        ...choice(changed),
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow("HOST_TRUST_DECISION_STALE");
    expect(
      (await f.service.decide("alice", choice(changed))).reconnectRequired,
    ).toBe(true);
    expect(await f.service.verify(target, key(2))).toBe(true);
    expect(await f.service.verify(target, key())).toBe(false);
  });
  it("does not adopt a legacy auto-accepted value without a fresh human choice", async () => {
    const f = fixture(),
      result = f.service.verify(target, key(), {
        legacy: key().toString("hex"),
      });
    const p = await request(f);
    expect(p.scenario).toBe("legacy");
    await f.service.decide("alice", choice(p, "reject"));
    expect(await result).toBe(false);
    expect(f.rows.size).toBe(0);
  });
  it("does not allow an older concurrent candidate to replace a newly confirmed key", async () => {
    const f = fixture(),
      a = f.service.verify(target, key()),
      b = f.service.verify(target, key(2));
    await vi.waitFor(() =>
      expect(f.service.list("alice").requests).toHaveLength(2),
    );
    const [one, two] = f.service.list("alice").requests;
    await f.service.decide("alice", choice(one));
    expect(await a).toBe(true);
    await expect(f.service.decide("alice", choice(two))).rejects.toThrow(
      "HOST_TRUST_RECORD_CHANGED",
    );
    expect(await b).toBe(false);
    expect([...f.rows.values()][0].fingerprint).toBe(one.fingerprint);
  });
  it("removes cancelled waits and cannot revive a timed-out handshake", async () => {
    const f = fixture(),
      stop = new AbortController(),
      a = f.service.verify(target, key(), { signal: stop.signal });
    await request(f);
    stop.abort();
    expect(await a).toBe(false);
    expect(f.service.list("alice").requests).toHaveLength(0);
    vi.useFakeTimers();
    const b = f.service.verify(target, key());
    await vi.advanceTimersByTimeAsync(1);
    const p = f.service.list("alice").requests[0];
    await vi.advanceTimersByTimeAsync(45000);
    expect(await b).toBe(false);
    await expect(f.service.decide("alice", choice(p))).rejects.toThrow(
      "HOST_TRUST_REQUEST_NOT_FOUND",
    );
  });
  it("never releases a waiter before a successful persistence barrier", async () => {
    const f = fixture();
    let fail!: (e: Error) => void;
    f.write.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    let outcome: unknown;
    const waiting = f.service
      .verify(target, key())
      .then((ok) => (outcome = ok));
    const p = await request(f),
      decision = f.service.decide("alice", choice(p));
    await vi.waitFor(() => expect(f.write).toHaveBeenCalled());
    expect(outcome).toBeUndefined();
    fail(Error("HOST_TRUST_STORAGE_UNAVAILABLE"));
    await expect(decision).rejects.toThrow("HOST_TRUST_STORAGE_UNAVAILABLE");
    await waiting;
    expect(outcome).toBe(false);
  });
});
