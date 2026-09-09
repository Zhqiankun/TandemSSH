import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DownloadService } from "./download-service.js";
import type { DownloadCheckpoint } from "./download-checkpoint.js";
const uuid = z.string().uuid();
export const recoveryIntentSchema = z
  .object({
    windowToken: uuid,
    kind: z.enum(["list", "save", "restore", "check", "remove", "discard"]),
    sourceId: uuid.optional(),
    sessionId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((p) =>
    p.kind === "save"
      ? !!p.sourceId && !p.sessionId
      : p.kind === "restore"
        ? !!p.sessionId && !p.sourceId
        : !p.sourceId && !p.sessionId,
  );
interface Ticket {
  id: string;
  windowToken: string;
  userId: string;
  kind: z.infer<typeof recoveryIntentSchema>["kind"];
  source?: DownloadCheckpoint;
  hostLabel?: string;
  sessionId?: string;
  claimed: boolean;
  expires: number;
  stop: AbortController;
  restoredId?: string;
  work?: Promise<unknown>;
}
export class DownloadRecoveryTickets {
  private windows = new Set<string>();
  private tickets = new Map<string, Ticket>();
  private sources = new Map<string, Map<string, string>>();
  constructor(
    private downloads: DownloadService,
    private available: () => boolean,
  ) {}
  bind(token: string) {
    if (!this.available()) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    uuid.parse(token);
    if (this.windows.size >= 16 && !this.windows.has(token))
      throw Error("DOWNLOAD_RECOVERY_BUSY");
    this.windows.add(token);
    return { bound: true };
  }
  private async release(ticket: Ticket) {
    ticket.stop.abort();
    if (ticket.restoredId) {
      try {
        await this.downloads.cancel(
          { userId: ticket.userId },
          ticket.restoredId,
        );
        this.downloads.forget({ userId: ticket.userId }, ticket.restoredId);
      } catch {
        /* The source may already have expired or been cleared by its queue. */
      }
    }
  }
  async releaseSource(token: string, id: string) {
    const rows = this.sources.get(token),
      userId = rows?.get(id);
    if (!userId) return { released: true };
    rows!.delete(id);
    try {
      this.downloads.forget({ userId }, id);
    } catch {
      try {
        await this.downloads.cancel({ userId }, id);
        this.downloads.forget({ userId }, id);
      } catch {
        /* The source may already have expired or been cleared by its queue. */
      }
    }
    return { released: true };
  }
  close(token: string) {
    this.windows.delete(token);
    for (const id of this.sources.get(token)?.keys() ?? [])
      void this.releaseSource(token, id);
    this.sources.delete(token);
    for (const [id, ticket] of this.tickets)
      if (ticket.windowToken === token) {
        this.tickets.delete(id);
        void this.release(ticket);
      }
    return { closed: true };
  }
  dispose() {
    for (const token of this.windows) this.close(token);
  }
  issue(userId: string, raw: unknown) {
    const p = recoveryIntentSchema.parse(raw);
    if (!this.available() || !this.windows.has(p.windowToken))
      throw Error("DOWNLOAD_DESKTOP_REQUIRED");
    for (const [id, t] of this.tickets)
      if (t.expires < Date.now()) {
        this.tickets.delete(id);
        void this.release(t);
      }
    if (this.tickets.size >= 256) throw Error("DOWNLOAD_RECOVERY_BUSY");
    const ticket: Ticket = {
      ...p,
      id: randomUUID(),
      userId,
      claimed: false,
      expires: Date.now() + 5 * 60_000,
      stop: new AbortController(),
    };
    if (p.kind === "save") {
      ticket.source = this.downloads.checkpoint({ userId }, p.sourceId!);
      ticket.hostLabel =
        this.downloads.get({ userId }, p.sourceId!).hostIdentity ?? "SSH";
    }
    this.tickets.set(ticket.id, ticket);
    return { ticketId: ticket.id };
  }
  private ticket(token: string, id: string) {
    const t = this.tickets.get(id);
    if (
      !t ||
      t.windowToken !== token ||
      !this.windows.has(token) ||
      t.expires < Date.now() ||
      t.stop.signal.aborted
    )
      throw Error("DOWNLOAD_RECOVERY_TICKET_INVALID");
    return t;
  }
  claim(token: string, id: string) {
    const t = this.ticket(token, id);
    if (t.claimed) throw Error("DOWNLOAD_RECOVERY_TICKET_USED");
    t.claimed = true;
    return {
      userId: t.userId,
      kind: t.kind,
      source: t.source,
      hostLabel: t.hostLabel,
      sessionId: t.sessionId,
    };
  }
  restore(token: string, id: string, source: unknown) {
    const t = this.ticket(token, id);
    if (!t.claimed || t.kind !== "restore")
      throw Error("DOWNLOAD_RECOVERY_TICKET_INVALID");
    if (!t.work)
      t.work = this.downloads
        .restore(
          { userId: t.userId, signal: t.stop.signal },
          source,
          t.sessionId!,
          randomUUID(),
        )
        .then(async (result) => {
          t.restoredId = result.id;
          if (t.stop.signal.aborted) {
            await this.release(t);
            throw Error("DOWNLOAD_CANCELLED");
          }
          return result;
        });
    return t.work;
  }
  async done(token: string, id: string, keepSource: boolean) {
    const t = this.tickets.get(id);
    if (!t || t.windowToken !== token) return { done: true };
    this.tickets.delete(id);
    if (!keepSource) await this.release(t);
    else if (t.restoredId) {
      let rows = this.sources.get(token);
      if (!rows) this.sources.set(token, (rows = new Map()));
      rows.set(t.restoredId, t.userId);
    }
    return { done: true };
  }
}
