export class S2SStartAdmission {
  private readonly pending = new Map<string, number>();
  acquire(name: string, liveNames: Iterable<string>): () => void {
    const names = new Set([...liveNames, ...this.pending.keys()]);
    if (!names.has(name) && names.size >= 32) throw Error("S2S_TUNNEL_LIMIT");
    const count = this.pending.get(name) ?? 0;
    if (count >= 8) throw Error("S2S_START_LIMIT");
    this.pending.set(name, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.pending.get(name) ?? 1) - 1;
      if (remaining) this.pending.set(name, remaining);
      else this.pending.delete(name);
    };
  }
}
