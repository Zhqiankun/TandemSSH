import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PairingSecretStore } from "./credential-store.js";
import type { BridgeClientIdentity, BridgePrincipal } from "./bridge/server.js";
import type { McpPairing } from "../../types/mcp-pairing.js";
const profileKey = "tandem-mcp-profile",
  clientsKey = "tandem-mcp-clients";
const recordSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().min(1),
    name: z.string().min(1).max(80),
    allowedHostIds: z.array(z.number().int().positive()).min(1).max(1000),
    readTerminal: z.boolean(),
    createdAt: z.number(),
    enabled: z.boolean(),
  })
  .strict();
type PairingRecord = z.infer<typeof recordSchema>;
export interface PairingRegistryPorts {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
  ownsHost(userId: string, id: number): Promise<boolean>;
  audit(userId: string, type: string, data: unknown): Promise<void>;
  revoke(clientId: string): void;
}
/** Settings hold scoped metadata; the OS credential store holds the only copy
 * of each shared secret. Credential failure never produces a plaintext key. */
export class PairingRegistry {
  private initialization?: Promise<string>;
  private readonly revoked = new Set<string>();
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly ports: PairingRegistryPorts,
    private readonly secrets: PairingSecretStore,
  ) {}
  initialize(): Promise<string> {
    if (!this.initialization)
      this.initialization = (async () => {
        let profile = this.ports.get(profileKey);
        if (profile) {
          if (!z.string().uuid().safeParse(profile).success)
            throw new Error("MCP_CONFIGURATION_INVALID");
          return profile;
        }
        profile = randomUUID();
        await this.ports.set(profileKey, profile);
        return profile;
      })().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }
  private records(): PairingRecord[] {
    const raw = this.ports.get(clientsKey);
    if (!raw) return [];
    try {
      return z.array(recordSchema).max(128).parse(JSON.parse(raw));
    } catch {
      throw new Error("MCP_CONFIGURATION_INVALID");
    }
  }
  list(userId: string): McpPairing[] {
    return this.records()
      .filter((record) => record.userId === userId)
      .map(({ userId: _owner, ...record }) => ({
        ...record,
        enabled: record.enabled && !this.revoked.has(record.id),
      }));
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const promise = this.mutations.then(work);
    this.mutations = promise.catch(() => {});
    return promise;
  }
  create(
    userId: string,
    input: { name: string; allowedHostIds: number[]; readTerminal: boolean },
  ): Promise<McpPairing> {
    return this.serialize(async () => {
      const profileId = await this.initialize();
      const record = recordSchema.parse({
        id: randomUUID(),
        userId,
        name: input.name,
        readTerminal: input.readTerminal,
        allowedHostIds: [...new Set(input.allowedHostIds)].sort(
          (a, b) => a - b,
        ),
        enabled: true,
        createdAt: Date.now(),
      });
      const records = this.records();
      if (records.length >= 128) throw new Error("MCP_CLIENT_LIMIT");
      for (const id of record.allowedHostIds)
        if (!(await this.ports.ownsHost(userId, id)))
          throw new Error("HOST_NOT_FOUND");
      await this.ports.audit(userId, "mcp.pairing.create-requested", {
        clientId: record.id,
        name: record.name,
        allowedHostIds: record.allowedHostIds,
        readTerminal: record.readTerminal,
      });
      const reference = { profileId, clientId: record.id };
      const secret = randomBytes(32);
      try {
        await this.secrets.write(reference, secret);
        await this.ports.set(clientsKey, JSON.stringify([...records, record]));
      } catch (error) {
        await this.secrets.remove(reference).catch(() => {});
        throw error;
      } finally {
        secret.fill(0);
      }
      const { userId: _owner, ...publicRecord } = record;
      return publicRecord;
    });
  }
  revoke(userId: string, clientId: string): Promise<void> {
    const record = this.records().find(
      (item) => item.id === clientId && item.userId === userId,
    );
    if (!record) return Promise.reject(new Error("MCP_CLIENT_NOT_FOUND"));
    this.revoked.add(clientId);
    this.ports.revoke(clientId);
    return this.serialize(async () => {
      const profileId = await this.initialize();
      const records = this.records().map((item) =>
        item.id === clientId ? { ...item, enabled: false } : item,
      );
      const results = await Promise.allSettled([
        this.ports.set(clientsKey, JSON.stringify(records)),
        this.secrets.remove({ profileId, clientId }),
      ]);
      // Either persistent disabled metadata or deleted credentials blocks future
      // authentication; if both fail, the current process still stays revoked.
      if (results.every((result) => result.status === "rejected"))
        throw new Error("MCP_REVOCATION_NOT_PERSISTED");
      await this.ports.audit(userId, "mcp.pairing.revoked", { clientId });
    });
  }
  async authenticate(
    clientId: string,
  ): Promise<{ identity: BridgeClientIdentity; secret: Uint8Array } | null> {
    const record = this.records().find(
      (item) => item.id === clientId && item.enabled,
    );
    if (!record || this.revoked.has(clientId)) return null;
    const profileId = await this.initialize();
    const secret = await this.secrets.read({ profileId, clientId });
    if (this.revoked.has(clientId)) {
      secret.fill(0);
      return null;
    }
    return {
      secret,
      identity: {
        clientId: record.id,
        userId: record.userId,
        allowedHostIds: [...record.allowedHostIds],
        readTerminal: record.readTerminal,
      },
    };
  }
  isAllowed(principal: BridgePrincipal): boolean {
    try {
      const record = this.records().find(
        (item) => item.id === principal.clientId,
      );
      return (
        !!record &&
        record.enabled &&
        !this.revoked.has(record.id) &&
        record.userId === principal.userId &&
        record.readTerminal === principal.readTerminal &&
        JSON.stringify(record.allowedHostIds) ===
          JSON.stringify(principal.allowedHostIds)
      );
    } catch {
      return false;
    }
  }
}
