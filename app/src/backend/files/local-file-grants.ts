import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FileTaskContext } from "./automated-documents.js";
import type {
  TaskLocalTransferPort,
  LocalUploadAccess,
  LocalDownloadAccess,
} from "./automated-transfers.js";
import type { FileTransferAction } from "../../types/file-transfer.js";
import type { DownloadSource } from "../../types/file-download.js";
import type {
  HumanLocalFileGrant,
  LocalFileGrantView,
  LocalFileTicket,
} from "../../types/local-file-grants.js";
export interface LocalTaskIdentity extends FileTaskContext {
  hostId: number;
  hostName: string;
  state: string;
  title: string;
}
export interface NativeLocalSelection {
  id: string;
  version: string;
  direction: "upload" | "download";
  name: string;
  path: string;
  size?: number;
  existing?: { size: number; modifiedAt: number };
  temporaryPath?: string;
  transferState?: string;
  busy?: boolean;
  consumed?: boolean;
}
export interface NativeTaskLocalFiles {
  select(
    direction: "upload" | "download",
    owner: string,
    paths: string[],
    guard: () => void,
  ): Promise<NativeLocalSelection[]>;
  view(id: string): NativeLocalSelection;
  upload(
    id: string,
    guard: () => void,
    signal: AbortSignal,
  ): Promise<LocalUploadAccess>;
  download(
    id: string,
    source: DownloadSource,
    guard: () => void,
    signal: AbortSignal,
  ): Promise<LocalDownloadAccess>;
  revoke(id: string): void;
  forget(id: string): Promise<void>;
  dispose(): Promise<void>;
}
interface Ports {
  available(): boolean;
  native(): NativeTaskLocalFiles;
  context(user: string, task: string): LocalTaskIdentity;
  audit(
    user: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}
const id = z.string().uuid();
export const localFileTicketSchema = z
  .object({
    windowToken: id,
    direction: z.enum(["upload", "download"]),
    allowOverwrite: z.boolean().default(false),
    suggestedName: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\x00-\x1f\x7f]+$/)
      .default("download.bin"),
  })
  .strict();
interface Ticket {
  id: string;
  windowToken: string;
  context: LocalTaskIdentity;
  direction: "upload" | "download";
  allowOverwrite: boolean;
  suggestedName: string;
  expiresAt: number;
  state: "pending" | "claimed" | "selecting";
}
interface Grant {
  native: NativeLocalSelection;
  windowToken: string;
  context: LocalTaskIdentity;
  allowOverwrite: boolean;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  error?: string;
}
const ended = (state: string) =>
  ["completed", "completed-with-errors", "cancelled"].includes(state);
const identityMatches = (a: LocalTaskIdentity, b: LocalTaskIdentity) =>
  a.userId === b.userId &&
  a.taskId === b.taskId &&
  a.sessionId === b.sessionId &&
  a.hostId === b.hostId &&
  a.hostName === b.hostName &&
  a.control.generation === b.control.generation;
export class LocalFileGrants implements TaskLocalTransferPort {
  private windows = new Set<string>();
  private tickets = new Map<string, Ticket>();
  private grants = new Map<string, Grant>();
  private selecting = 0;
  private reserved = 0;
  private userReservations = new Map<string, number>();
  constructor(private ports: Ports) {}
  available() {
    return this.ports.available();
  }
  private desktop() {
    if (!this.available()) throw Error("FILE_LOCAL_DESKTOP_REQUIRED");
  }
  bindWindow(token: string) {
    this.desktop();
    id.parse(token);
    if (this.windows.size >= 8 && !this.windows.has(token))
      throw Error("FILE_LOCAL_GRANT_LIMIT");
    this.windows.add(token);
    return { windowToken: token };
  }
  closeWindow(token: string) {
    this.windows.delete(token);
    for (const [key, t] of this.tickets)
      if (t.windowToken === token) this.tickets.delete(key);
    for (const g of this.grants.values())
      if (g.windowToken === token)
        this.invalidate(g, "FILE_LOCAL_WINDOW_CLOSED");
    return null;
  }
  private invalidate(g: Grant, error: string) {
    if (g.revoked) return;
    g.revoked = true;
    g.error = error;
    this.ports.native().revoke(g.native.id);
  }
  private active(g: Grant) {
    if (g.revoked) throw Error(g.error ?? "FILE_LOCAL_GRANT_REVOKED");
    try {
      if (!this.windows.has(g.windowToken))
        throw Error("FILE_LOCAL_WINDOW_CLOSED");
      if (g.expiresAt <= Date.now()) throw Error("FILE_LOCAL_GRANT_EXPIRED");
      const current = this.ports.context(g.context.userId, g.context.taskId);
      if (ended(current.state)) throw Error("FILE_LOCAL_TASK_ENDED");
      if (!identityMatches(current, g.context))
        throw Error("FILE_LOCAL_CONNECTION_CHANGED");
    } catch (e) {
      this.invalidate(
        g,
        e instanceof Error && /^[A-Z_]+$/.test(e.message)
          ? e.message
          : "FILE_LOCAL_GRANT_REVOKED",
      );
      throw Error(g.error);
    }
  }
  private publicView(g: Grant): LocalFileGrantView {
    try {
      this.active(g);
    } catch {
      /* Revocation remains visible in the human list. */
    }
    const native = this.ports.native().view(g.native.id);
    return {
      id: g.native.id,
      version: g.native.version,
      taskId: g.context.taskId,
      direction: g.native.direction,
      name: g.native.name,
      size: g.native.size,
      allowOverwrite: g.allowOverwrite,
      state: g.revoked ? "revoked" : native.consumed ? "consumed" : "active",
      createdAt: g.createdAt,
      expiresAt: g.expiresAt,
      error: g.error,
    };
  }
  list(user: string, task: string): LocalFileGrantView[] {
    return [...this.grants.values()]
      .filter((g) => g.context.userId === user && g.context.taskId === task)
      .map((g) => this.publicView(g));
  }
  humanList(user: string, task: string): HumanLocalFileGrant[] {
    return [...this.grants.values()]
      .filter((g) => g.context.userId === user && g.context.taskId === task)
      .map((g) => ({
        ...this.publicView(g),
        path: g.native.path,
        existing: g.native.existing,
        temporaryPath: this.ports.native().view(g.native.id).temporaryPath,
        transferState: this.ports.native().view(g.native.id).transferState,
      }));
  }
  issue(user: string, task: string, input: unknown): LocalFileTicket {
    this.desktop();
    const p = localFileTicketSchema.parse(input),
      context = this.ports.context(user, task);
    if (!this.windows.has(p.windowToken))
      throw Error("FILE_LOCAL_WINDOW_CLOSED");
    if (ended(context.state)) throw Error("FILE_LOCAL_TASK_ENDED");
    for (const [key, t] of this.tickets)
      if (t.expiresAt <= Date.now()) this.tickets.delete(key);
    if (
      this.tickets.size >= 32 ||
      [...this.tickets.values()].filter((t) => t.context.userId === user)
        .length >= 4
    )
      throw Error("FILE_LOCAL_GRANT_LIMIT");
    const ticket: Ticket = {
      ...p,
      id: randomUUID(),
      context: structuredClone(context),
      expiresAt: Date.now() + 5 * 60 * 1000,
      state: "pending",
    };
    this.tickets.set(ticket.id, ticket);
    return {
      id: ticket.id,
      direction: ticket.direction,
      expiresAt: ticket.expiresAt,
    };
  }
  private ticket(token: string, ticketId: string) {
    const t = this.tickets.get(ticketId);
    if (!t || t.windowToken !== token || !this.windows.has(token))
      throw Error("FILE_LOCAL_TICKET_INVALID");
    const current = this.ports.context(t.context.userId, t.context.taskId);
    if (
      t.expiresAt <= Date.now() ||
      ended(current.state) ||
      !identityMatches(current, t.context)
    ) {
      this.tickets.delete(ticketId);
      throw Error("FILE_LOCAL_TICKET_EXPIRED");
    }
    return t;
  }
  claim(token: string, ticketId: string) {
    const t = this.ticket(token, ticketId);
    if (t.state !== "pending") throw Error("FILE_LOCAL_TICKET_USED");
    t.state = "claimed";
    return {
      direction: t.direction,
      suggestedName: t.suggestedName,
      title: t.context.title.slice(0, 120),
      allowOverwrite: t.allowOverwrite,
    };
  }
  cancel(token: string, ticketId: string) {
    const t = this.tickets.get(ticketId);
    if (t?.windowToken === token) this.tickets.delete(ticketId);
    return null;
  }
  cancelHuman(user: string, task: string, ticketId: string) {
    const t = this.tickets.get(ticketId);
    if (t?.context.userId === user && t.context.taskId === task)
      this.tickets.delete(ticketId);
    return null;
  }
  async fulfill(
    token: string,
    ticketId: string,
    paths: string[],
  ): Promise<{ grants: HumanLocalFileGrant[] }> {
    const t = this.ticket(token, ticketId);
    if (t.state !== "claimed") throw Error("FILE_LOCAL_TICKET_USED");
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > 32 ||
      paths.some((p) => typeof p !== "string" || p.length > 4096)
    )
      throw Error("FILE_LOCAL_SELECTION_INVALID");
    if (
      this.selecting >= 2 ||
      this.grants.size + this.reserved + paths.length > 128 ||
      [...this.grants.values()].filter(
        (g) => g.context.userId === t.context.userId,
      ).length +
        (this.userReservations.get(t.context.userId) ?? 0) +
        paths.length >
        32
    )
      throw Error("FILE_LOCAL_GRANT_LIMIT");
    t.state = "selecting";
    this.selecting++;
    this.reserved += paths.length;
    this.userReservations.set(
      t.context.userId,
      (this.userReservations.get(t.context.userId) ?? 0) + paths.length,
    );
    let selected: NativeLocalSelection[] = [];
    const guard = () => {
      if (this.ticket(token, ticketId) !== t || t.state !== "selecting")
        throw Error("FILE_LOCAL_TICKET_INVALID");
    };
    try {
      selected = await this.ports
        .native()
        .select(t.direction, t.context.userId, paths, guard);
      guard();
      await this.ports.audit(t.context.userId, "local_file.granted", {
        taskId: t.context.taskId,
        sessionId: t.context.sessionId,
        direction: t.direction,
        allowOverwrite: t.allowOverwrite,
        files: selected.map((e) => ({ id: e.id, name: e.name, size: e.size })),
      });
      guard();
      for (const native of selected)
        this.grants.set(native.id, {
          native,
          windowToken: token,
          context: t.context,
          allowOverwrite: t.allowOverwrite,
          createdAt: Date.now(),
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
          revoked: false,
        });
      const ids = new Set(selected.map((e) => e.id));
      return {
        grants: this.humanList(t.context.userId, t.context.taskId).filter((g) =>
          ids.has(g.id),
        ),
      };
    } catch (error) {
      for (const native of selected) {
        this.ports.native().revoke(native.id);
        await this.ports
          .native()
          .forget(native.id)
          .catch(() => {});
      }
      throw error;
    } finally {
      this.selecting--;
      this.reserved -= paths.length;
      const remaining =
        (this.userReservations.get(t.context.userId) ?? 0) - paths.length;
      if (remaining) this.userReservations.set(t.context.userId, remaining);
      else this.userReservations.delete(t.context.userId);
      this.tickets.delete(ticketId);
    }
  }
  private owned(user: string, task: string, grantId: string) {
    const g = this.grants.get(grantId);
    if (!g || g.context.userId !== user || g.context.taskId !== task)
      throw Error("FILE_LOCAL_GRANT_NOT_FOUND");
    return g;
  }
  async revoke(user: string, task: string, grantId: string) {
    const g = this.owned(user, task, grantId);
    this.invalidate(g, "FILE_LOCAL_GRANT_REVOKED");
    try {
      await this.ports.audit(user, "local_file.revoked", {
        taskId: task,
        grantId,
      });
    } catch {
      g.error = "AUDIT_UNAVAILABLE";
    }
    return this.publicView(g);
  }
  async forget(user: string, task: string, grantId: string) {
    const g = this.owned(user, task, grantId);
    this.invalidate(g, "FILE_LOCAL_GRANT_REVOKED");
    await this.ports.native().forget(grantId);
    this.grants.delete(grantId);
    return { id: grantId };
  }
  assert(context: FileTaskContext, action: FileTransferAction) {
    const g = this.owned(context.userId, context.taskId, action.localGrantId);
    this.active(g);
    if (
      g.context.sessionId !== context.sessionId ||
      g.context.control.generation !== context.control.generation ||
      g.native.version !== action.localVersion ||
      action.type !== "file." + g.native.direction
    )
      throw Error("FILE_LOCAL_GRANT_REQUIRED");
    if (action.overwrite && !g.allowOverwrite)
      throw Error("FILE_LOCAL_OVERWRITE_REQUIRED");
    if (this.ports.native().view(g.native.id).consumed)
      throw Error("FILE_LOCAL_GRANT_CONSUMED");
  }
  async upload(
    context: FileTaskContext,
    action: FileTransferAction,
    guard: () => void,
    signal: AbortSignal,
  ) {
    this.assert(context, action);
    return this.ports.native().upload(
      action.localGrantId,
      () => {
        this.assert(context, action);
        guard();
      },
      signal,
    );
  }
  async download(
    context: FileTaskContext,
    action: FileTransferAction,
    source: DownloadSource,
    guard: () => void,
    signal: AbortSignal,
  ) {
    this.assert(context, action);
    return this.ports.native().download(
      action.localGrantId,
      source,
      () => {
        this.assert(context, action);
        guard();
      },
      signal,
    );
  }
  async dispose() {
    for (const token of this.windows) this.closeWindow(token);
    if (this.grants.size) await this.ports.native().dispose();
  }
}
