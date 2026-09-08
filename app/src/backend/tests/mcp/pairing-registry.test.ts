import { describe, expect, it, vi } from "vitest";
import { PairingRegistry } from "../../mcp/pairing-registry.js";
function fixture() {
  const settings = new Map<string, string>(),
    credentials = new Map<string, Uint8Array>();
  const revoke = vi.fn();
  let fail = false;
  const registry = new PairingRegistry(
    {
      get: (key) => settings.get(key),
      set: async (key, value) => {
        if (fail) throw Error("disk full");
        settings.set(key, value);
      },
      ownsHost: async (userId, id) => userId === "owner" && id === 7,
      audit: async () => {},
      revoke,
    },
    {
      read: async (reference) => {
        const value = credentials.get(reference.clientId);
        if (!value) throw Error("MCP_PAIRING_NOT_FOUND");
        return Uint8Array.from(value);
      },
      write: async (reference, value) => {
        credentials.set(reference.clientId, Uint8Array.from(value));
      },
      remove: async (reference) => credentials.delete(reference.clientId),
    },
  );
  return {
    registry,
    settings,
    credentials,
    revoke,
    failWrites: () => {
      fail = true;
    },
  };
}
describe("scoped OS-backed pairing metadata", () => {
  it("stores only metadata and stable IDs while keeping the secret in the credential port", async () => {
    const f = fixture();
    const client = await f.registry.create("owner", {
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
    });
    const metadata = [...f.settings.values()].join("");
    const secret = f.credentials.get(client.id)!;
    expect(secret).toHaveLength(32);
    expect(metadata).not.toContain(Buffer.from(secret).toString("hex"));
    expect(metadata).not.toContain(Buffer.from(secret).toString("base64"));
    expect(f.registry.list("other")).toEqual([]);
    expect((await f.registry.authenticate(client.id))?.identity).toMatchObject({
      userId: "owner",
      allowedHostIds: [7],
      readTerminal: false,
    });
  });
  it("validates host ownership before creating a credential", async () => {
    const f = fixture();
    await expect(
      f.registry.create("owner", {
        name: "Codex",
        allowedHostIds: [8],
        readTerminal: true,
      }),
    ).rejects.toThrow("HOST_NOT_FOUND");
    expect(f.credentials.size).toBe(0);
  });
  it("revokes active identity synchronously and removes its persisted secret", async () => {
    const f = fixture();
    const client = await f.registry.create("owner", {
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
    });
    const pending = f.registry.revoke("owner", client.id);
    expect(f.revoke).toHaveBeenCalledWith(client.id);
    expect(f.registry.list("owner")[0].enabled).toBe(false);
    await pending;
    expect(await f.registry.authenticate(client.id)).toBeNull();
    expect(f.credentials.size).toBe(0);
  });
  it("cannot revoke another user's client", async () => {
    const f = fixture();
    const client = await f.registry.create("owner", {
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
    });
    await expect(f.registry.revoke("other", client.id)).rejects.toThrow(
      "MCP_CLIENT_NOT_FOUND",
    );
    expect(f.revoke).not.toHaveBeenCalled();
    expect(f.credentials.size).toBe(1);
  });
  it("cleans up the credential if metadata persistence fails", async () => {
    const f = fixture();
    await f.registry.initialize();
    f.failWrites();
    await expect(
      f.registry.create("owner", {
        name: "Codex",
        allowedHostIds: [7],
        readTerminal: false,
      }),
    ).rejects.toThrow();
    expect(f.credentials.size).toBe(0);
  });
  it("keeps future authentication blocked if metadata cannot be updated during revocation", async () => {
    const f = fixture();
    const client = await f.registry.create("owner", {
      name: "Codex",
      allowedHostIds: [7],
      readTerminal: false,
    });
    f.failWrites();
    await f.registry.revoke("owner", client.id);
    expect(f.credentials.size).toBe(0);
    expect(await f.registry.authenticate(client.id)).toBeNull();
  });
});
