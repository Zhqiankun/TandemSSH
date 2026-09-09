import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    getSecret = native.read;
    setSecret = native.write;
  },
}));
import { SystemDraftKey } from "../../files/drafts/system-key";
beforeEach(() => {
  vi.clearAllMocks();
});
it("accepts the actual native number-array result when verifying a new key", async () => {
  let value: number[] | undefined;
  native.read.mockImplementation(async () => value);
  native.write.mockImplementation(async (key: Uint8Array) => {
    value = [...key];
  });
  const store = new SystemDraftKey("./test-draft-profile"),
    key = await store.load("user", true);
  expect(key).toHaveLength(32);
  expect(await store.load("user", false)).toEqual(key);
  expect(native.write).toHaveBeenCalledOnce();
});
it("does not create a key during a read or hide credential-store failure", async () => {
  native.read.mockResolvedValue(undefined);
  expect(await new SystemDraftKey("./test").load("user", false)).toBeNull();
  expect(native.write).not.toHaveBeenCalled();
  native.read.mockRejectedValue(Error("locked"));
  await expect(new SystemDraftKey("./test").load("user", true)).rejects.toThrow(
    "locked",
  );
  expect(native.write).not.toHaveBeenCalled();
});
