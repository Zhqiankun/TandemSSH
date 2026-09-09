import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DownloadService } from "./download-service.js";
import type { DownloadTreeService } from "./download-tree-service.js";
import type { DownloadRecoveryTickets } from "./download-recovery-tickets.js";
import type { DownloadCheckpoint } from "./download-checkpoint.js";
const id = z.string().uuid();
export const downloadBatchIntentSchema = z
  .object({
    windowToken: id,
    kind: z.enum([
      "list",
      "detail",
      "save",
      "restore",
      "check",
      "discard",
      "remove",
    ]),
    treeId: id.optional(),
    sources: z
      .array(z.object({ entryId: id, sourceId: id }).strict())
      .max(128)
      .optional(),
    sessionId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((p) =>
    p.kind === "save"
      ? !!p.treeId && !p.sessionId
      : p.kind === "restore"
        ? !!p.sessionId && !p.treeId && !p.sources
        : !p.treeId && !p.sessionId && !p.sources,
  );
interface Ticket {
  id: string;
  userId: string;
  windowToken: string;
  kind: z.infer<typeof downloadBatchIntentSchema>["kind"];
  sessionId?: string;
  source?: {
    tree: ReturnType<DownloadTreeService["checkpoint"]>;
    members: Array<{ entryId: string; source: DownloadCheckpoint }>;
  };
  treeId?: string;
  claimed: boolean;
  expires: number;
  stop: AbortController;
  sources: Set<string>;
  work?: Promise<unknown>;
}
export class DownloadBatchRecoveryTickets {
  private tickets = new Map<string, Ticket>();
  constructor(
    private trees: DownloadTreeService,
    private downloads: DownloadService,
    private windows: DownloadRecoveryTickets,
  ) {
    windows.onClose((token) => this.close(token));
  }
  issue(userId: string, raw: unknown) {
    const p = downloadBatchIntentSchema.parse(raw);
    if (!this.windows.isBound(p.windowToken))
      throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    for (const [id, t] of this.tickets)
      if (t.expires < Date.now() && !t.claimed) {
        this.tickets.delete(id);
        t.stop.abort();
      }
    if (this.tickets.size >= 128) throw Error("DOWNLOAD_BATCH_BUSY");
    const ticket: Ticket = {
      ...p,
      id: randomUUID(),
      userId,
      claimed: false,
      expires: Date.now() + 300000,
      stop: new AbortController(),
      sources: new Set(),
    };
    if (p.kind === "save") {
      const tree = this.trees.checkpoint({ userId }, p.treeId!),
        seen = new Set<string>(),
        members = (p.sources ?? []).map((m) => {
          if (seen.has(m.entryId)) throw Error("DOWNLOAD_BATCH_MEMBER_INVALID");
          seen.add(m.entryId);
          return {
            entryId: m.entryId,
            source: this.trees.memberProof(
              { userId },
              p.treeId!,
              m.entryId,
              m.sourceId,
            ),
          };
        });
      ticket.source = { tree, members };
    }
    this.tickets.set(ticket.id, ticket);
    return { ticketId: ticket.id };
  }
  private owned(token: string, id: string) {
    const t = this.tickets.get(id);
    if (
      !t ||
      t.windowToken !== token ||
      !this.windows.isBound(token) ||
      t.stop.signal.aborted ||
      (!t.claimed && t.expires < Date.now())
    )
      throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    return t;
  }
  claim(token: string, id: string) {
    const t = this.owned(token, id);
    if (t.claimed) throw Error("DOWNLOAD_BATCH_TICKET_USED");
    t.claimed = true;
    return {
      userId: t.userId,
      kind: t.kind,
      source: t.source,
      sessionId: t.sessionId,
    };
  }
  async restoreTree(token: string, id: string, raw: unknown) {
    const t = this.owned(token, id);
    if (!t.claimed || t.kind !== "restore")
      throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    if (t.treeId || t.work) throw Error("DOWNLOAD_BATCH_TICKET_USED");
    const work = this.trees.restore(
      { userId: t.userId, signal: t.stop.signal },
      raw,
      t.sessionId!,
    );
    t.work = work;
    const tree = await work;
    t.treeId = tree.id;
    if (t.stop.signal.aborted) {
      this.trees.forget({ userId: t.userId }, tree.id);
      throw Error("DOWNLOAD_CANCELLED");
    }
    return tree;
  }
  async restoreSource(
    token: string,
    id: string,
    entryId: string,
    raw: unknown,
  ) {
    const t = this.owned(token, id);
    if (!t.claimed || !t.treeId || t.kind !== "restore")
      throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    const source = await this.downloads.restore(
      { userId: t.userId, signal: t.stop.signal },
      raw,
      t.sessionId!,
      randomUUID(),
    );
    try {
      this.trees.memberProof(
        { userId: t.userId },
        t.treeId,
        entryId,
        source.id,
      );
      if (t.stop.signal.aborted) throw Error("DOWNLOAD_CANCELLED");
      t.sources.add(source.id);
      return source;
    } catch (error) {
      await this.downloads.cancel({ userId: t.userId }, source.id);
      this.downloads.forget({ userId: t.userId }, source.id);
      throw error;
    }
  }
  proof(
    token: string,
    id: string,
    entryId: string,
    sourceId: string,
    verified = false,
  ) {
    const t = this.owned(token, id);
    if (!t.claimed || !t.treeId || t.kind !== "restore")
      throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    if (
      verified &&
      this.downloads.get({ userId: t.userId }, sourceId).state !== "verified"
    )
      throw Error("DOWNLOAD_NOT_READY");
    const source = this.trees.memberProof(
      { userId: t.userId },
      t.treeId,
      entryId,
      sourceId,
    );
    t.sources.add(sourceId);
    return source;
  }
  snapshot(token: string, id: string) {
    const t = this.owned(token, id);
    if (!t.claimed || !t.treeId) throw Error("DOWNLOAD_BATCH_TICKET_INVALID");
    return this.trees.checkpoint({ userId: t.userId }, t.treeId);
  }
  async done(token: string, id: string, releaseSaved = false) {
    const t = this.tickets.get(id);
    if (!t || t.windowToken !== token) return { done: true };
    this.tickets.delete(id);
    t.stop.abort();
    await t.work?.catch(() => {});
    for (const sourceId of t.sources) {
      try {
        await this.downloads.cancel({ userId: t.userId }, sourceId);
        this.downloads.forget({ userId: t.userId }, sourceId);
      } catch {
        /* The source may already have been released by its queue. */
      }
    }
    if (t.treeId)
      try {
        this.trees.forget({ userId: t.userId }, t.treeId);
      } catch {
        /* The source may already have been released by its queue. */
      }
    if (releaseSaved && t.source) {
      for (const m of t.source.members) {
        try {
          await this.downloads.cancel({ userId: t.userId }, m.source.id);
          this.downloads.forget({ userId: t.userId }, m.source.id);
        } catch {
          /* Teardown keeps already released sources closed. */
        }
      }
      try {
        this.trees.forget({ userId: t.userId }, t.source.tree.id);
      } catch {
        /* Teardown keeps already released sources closed. */
      }
    }
    return { done: true };
  }
  dispose() {
    for (const token of new Set(
      [...this.tickets.values()].map((t) => t.windowToken),
    ))
      this.close(token);
  }
  close(token: string) {
    for (const t of this.tickets.values())
      if (t.windowToken === token) void this.done(token, t.id);
  }
}
