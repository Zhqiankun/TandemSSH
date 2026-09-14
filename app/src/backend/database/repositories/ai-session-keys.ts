type KeyRecord = { userId: string; id?: number; bytes: Buffer };
/** Process-local AI provider keys. No filesystem, logging or renderer access. */
export class AiSessionKeys {
  private keys = new Map<string, KeyRecord>();
  private pending = new Map<symbol, KeyRecord>();
  private key(userId: string, id: number) {
    return JSON.stringify([userId, id]);
  }
  validate(value: string) {
    if (Buffer.byteLength(value) > 16384)
      throw Error("AI_SESSION_KEY_TOO_LARGE");
  }
  prepare(userId: string, value: string, replacingId?: number) {
    this.validate(value);
    const replacing =
      replacingId !== undefined && this.keys.has(this.key(userId, replacingId));
    if (this.keys.size + this.pending.size - (replacing ? 1 : 0) >= 256)
      throw Error("AI_SESSION_KEY_LIMIT");
    const token = Symbol(),
      record: KeyRecord = {
        userId,
        id: replacingId,
        bytes: Buffer.from(value),
      };
    this.pending.set(token, record);
    const active = () => {
      if (!this.pending.has(token)) throw Error("AI_SESSION_KEY_EXPIRED");
    };
    return {
      bind: (id: number) => {
        active();
        record.id = id;
        this.remove(userId, id, token);
      },
      commit: (id: number) => {
        active();
        if (record.id !== id) throw Error("AI_SESSION_KEY_EXPIRED");
        this.pending.delete(token);
        this.keys.set(this.key(userId, id), record);
      },
      discard: () => {
        if (this.pending.delete(token)) record.bytes.fill(0);
      },
    };
  }
  get(userId: string, id: number) {
    return this.keys.get(this.key(userId, id))?.bytes.toString();
  }
  remove(userId: string, id: number, except?: symbol) {
    const key = this.key(userId, id);
    this.keys.get(key)?.bytes.fill(0);
    this.keys.delete(key);
    for (const [token, record] of this.pending)
      if (token !== except && record.userId === userId && record.id === id) {
        record.bytes.fill(0);
        this.pending.delete(token);
      }
  }
  clear(userId?: string) {
    for (const [key, record] of this.keys)
      if (userId === undefined || record.userId === userId) {
        record.bytes.fill(0);
        this.keys.delete(key);
      }
    for (const [token, record] of this.pending)
      if (userId === undefined || record.userId === userId) {
        record.bytes.fill(0);
        this.pending.delete(token);
      }
  }
}
export const aiSessionKeys = new AiSessionKeys();
