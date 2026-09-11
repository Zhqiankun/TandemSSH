import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    getSecret = native.read;
    setSecret = native.write;
    deleteCredential = native.remove;
  },
}));
import { SystemWorkflowSecretStore } from "../../collaboration/workflows/secrets/system-store.js";
const reference = {
  profileId: randomUUID(),
  userId: randomUUID(),
  secretId: randomUUID(),
};
beforeEach(() => vi.resetAllMocks());
it("does not read the OS store when authorization has already been revoked", async () => {
  const consume = vi.fn();
  await expect(
    new SystemWorkflowSecretStore().use(
      reference,
      () => {
        throw Error("STALE_CONTROL");
      },
      consume,
    ),
  ).rejects.toThrow("STALE_CONTROL");
  expect(native.read).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
});
it("does not deliver a secret when authority changes during the OS read, and clears native bytes", async () => {
  let release!: (bytes: number[]) => void;
  native.read.mockReturnValue(
    new Promise<number[]>((resolve) => {
      release = resolve;
    }),
  );
  let revoked = false;
  const consume = vi.fn(),
    guard = vi.fn(() => {
      if (revoked) throw Error("STALE_CONTROL");
    });
  const pending = new SystemWorkflowSecretStore().use(
    reference,
    guard,
    consume,
  );
  expect(native.read).toHaveBeenCalledOnce();
  revoked = true;
  const raw = [65, 66, 67];
  release(raw);
  await expect(pending).rejects.toThrow("STALE_CONTROL");
  expect(consume).not.toHaveBeenCalled();
  expect(guard).toHaveBeenCalledTimes(2);
  expect(raw).toEqual([0, 0, 0]);
});
it("delivers only after both checks and clears native and normalized storage", async () => {
  const raw = [65, 66],
    guard = vi.fn();
  native.read.mockResolvedValue(raw);
  let borrowed!: Uint8Array;
  await new SystemWorkflowSecretStore().use(reference, guard, async (bytes) => {
    expect(guard).toHaveBeenCalledTimes(2);
    expect([...bytes]).toEqual([65, 66]);
    borrowed = bytes;
  });
  expect(raw).toEqual([0, 0]);
  expect([...borrowed]).toEqual([0, 0]);
});
it("rejects invalid native bytes without passing them to a consumer", async () => {
  const raw = [65, 256],
    consume = vi.fn();
  native.read.mockResolvedValue(raw);
  await expect(
    new SystemWorkflowSecretStore().use(reference, () => {}, consume),
  ).rejects.toThrow("INVALID_WORKFLOW_SECRET");
  expect(consume).not.toHaveBeenCalled();
  expect(raw).toEqual([0, 0]);
});
it("maps native failure without exposing its message or starting consumption", async () => {
  native.read.mockRejectedValue(Error("native details include sensitive text"));
  const consume = vi.fn();
  await expect(
    new SystemWorkflowSecretStore().use(reference, () => {}, consume),
  ).rejects.toThrow("WORKFLOW_SECRET_STORE_UNAVAILABLE");
  expect(consume).not.toHaveBeenCalled();
});
