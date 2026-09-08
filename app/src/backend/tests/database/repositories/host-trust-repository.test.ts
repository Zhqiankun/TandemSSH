import { afterEach, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "./test-support";
import { HostTrustRepository } from "../../../database/repositories/host-trust-repository";
import { hostTrustId } from "../../../hosts/trust/fingerprint";
import type { HostTrustRecord } from "../../../../types/host-trust";
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of close.splice(0)) await fn();
});
const record = (fingerprint = "SHA256:" + "a".repeat(43)): HostTrustRecord => ({
  id: hostTrustId("alice", "host", 22),
  userId: "alice",
  profileScope: "quick",
  address: "host",
  port: 22,
  fingerprint,
  keyType: "ssh-ed25519",
  revision: 1,
  approvedAt: new Date().toISOString(),
});
async function setup(persist?: () => Promise<void>) {
  const db = new TestSqliteDatabase(),
    context = await db.connect();
  close.push(() => db.close());
  await db.exec(
    "INSERT INTO users (id,username,password_hash) VALUES ('alice','alice','hash'),('bob','bob','hash')",
  );
  return { db, context, repo: new HostTrustRepository(context, persist) };
}
it("isolates user records and compares versions for insert and update", async () => {
  const f = await setup(),
    r = record();
  await f.repo.compareAndSet(r, 0);
  expect(await f.repo.get(r.id, "alice")).toEqual(r);
  expect(await f.repo.get(r.id, "bob")).toBeUndefined();
  await expect(
    f.repo.compareAndSet({ ...r, fingerprint: "SHA256:" + "b".repeat(43) }, 0),
  ).rejects.toThrow("HOST_TRUST_RECORD_CHANGED");
  await f.repo.compareAndSet({ ...r, revision: 2 }, 1);
  await expect(f.repo.compareAndSet({ ...r, revision: 2 }, 1)).rejects.toThrow(
    "HOST_TRUST_RECORD_CHANGED",
  );
});
it("serializes reads behind persistence and poisons all repository instances after failure", async () => {
  let reject!: (e: Error) => void;
  const persist = vi.fn(() => new Promise<void>((_, fail) => (reject = fail))),
    f = await setup(persist),
    r = record();
  const save = f.repo.compareAndSet(r, 0);
  await vi.waitFor(() => expect(persist).toHaveBeenCalled());
  let readFinished = false;
  const other = new HostTrustRepository(f.context, persist),
    reading = other.get(r.id, "alice").finally(() => {
      readFinished = true;
    });
  void reading.catch(() => {});
  expect(readFinished).toBe(false);
  reject(Error("disk full"));
  await expect(save).rejects.toThrow("HOST_TRUST_STORAGE_UNAVAILABLE");
  await expect(reading).rejects.toThrow("HOST_TRUST_STORAGE_UNAVAILABLE");
  await expect(
    new HostTrustRepository(f.context).get(r.id, "alice"),
  ).rejects.toThrow("HOST_TRUST_STORAGE_UNAVAILABLE");
});
