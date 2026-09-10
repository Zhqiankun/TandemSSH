import { type Client, type ClientChannel } from "ssh2";
import { terminalOutputDelivery } from "./output-delivery.js";
import { RecordingWriter } from "./recording-writer.js";
import {
  recordingFailureReason,
  type RecordingFailure,
} from "../../../types/terminal-recording.js";
import {
  ControlError,
  SessionControl,
} from "../../collaboration/sessions/control.js";
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import { sshLogger } from "../../utils/logger.js";
import {
  getCurrentSettingValue,
  createCurrentSessionRecordingRepository,
} from "../../database/repositories/factory.js";

const MAX_BUFFER_BYTES = 512 * 1024;
const DATA_DIR = process.env.DATA_DIR ?? "./db/data";
const SESSION_LOGS_DIR = path.join(DATA_DIR, "session_logs");
const DEFAULT_TIMEOUT_MINUTES = 30;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_SESSIONS_PER_USER = 10;
export interface SessionParticipant {
  ws: WebSocket;
  userId: string | null; // null for anonymous link guests
  permissionLevel: "read-write" | "read-only";
  isOwner: boolean;
  guestLabel?: string;
  tabInstanceId?: string;
  joinedViaShareId?: string;
}

export interface TerminalSession {
  id: string;
  control: SessionControl;
  userId: string;
  hostId: number;
  hostName: string;
  tabInstanceId?: string;
  attachedTabInstanceId?: string;

  sshConn: Client | null;
  sshStream: ClientChannel | null;
  jumpClient: Client | null;

  cols: number;
  rows: number;
  isConnected: boolean;
  createdAt: number;

  participants: Map<string, SessionParticipant>;
  lastDetachedAt: number | null;
  detachTimeout: NodeJS.Timeout | null;

  outputBuffer: string[];
  outputBufferBytes: number;
  outputSequence: number;
  outputTruncated: boolean;
  outputGap: boolean;
  recordingPath: string | null;
  recordingHeader: string | null;
  recordingBytes: number;
  recordingId: number | null;
  recordingWriter: RecordingWriter | null;
  recordingFailure: RecordingFailure | null;
  recordingEndedAt: number | null;
  recordingPersistChain: Promise<void>;
  recordingPersistRunning: boolean;
  recordingPersistRequested: boolean;
  lastPersistedFailure: RecordingFailure | null;
  tmuxSessionName: string | null;
  sessionLoggingEnabled: boolean;
  sessionStartedAt: number;
  lastPersistedBytes: number;
  terminatedByOwner: boolean;
  terminationReason: string | null;
}

/** Message types a non-owner participant may legally send. */
const NON_OWNER_ALLOWED_MESSAGE_TYPES = new Set([
  "input",
  "terminal-reply",
  "terminal-output-ack",
  "ping",
  "disconnect",
]);

/**
 * Server-side gate for whether a participant may send a given WS message
 * type. The owner may send anything; non-owners are limited to input (if
 * read-write), ping, and disconnect. Pure function so read-only enforcement
 * is unit-testable without a real WebSocketServer.
 */
export function isMessageAllowedForParticipant(
  participant: Pick<SessionParticipant, "isOwner" | "permissionLevel"> | null,
  messageType: string,
): boolean {
  if (!participant || participant.isOwner) return true;
  if (!NON_OWNER_ALLOWED_MESSAGE_TYPES.has(messageType)) return false;
  if (
    (messageType === "input" || messageType === "terminal-reply") &&
    participant.permissionLevel === "read-only"
  ) {
    return false;
  }
  return true;
}

class TerminalSessionManager {
  private static instance: TerminalSessionManager;
  private sessions = new Map<string, TerminalSession>();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      HEALTH_CHECK_INTERVAL_MS,
    );
  }

  static getInstance(): TerminalSessionManager {
    if (!TerminalSessionManager.instance) {
      TerminalSessionManager.instance = new TerminalSessionManager();
    }
    return TerminalSessionManager.instance;
  }

  createSession(
    userId: string,
    hostId: number,
    hostName: string,
    cols: number,
    rows: number,
    tabInstanceId?: string,
    sessionLoggingEnabled = false,
  ): string {
    const userSessions = this.getUserSessions(userId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      const detached = userSessions
        .filter((s) => this.getOwnerParticipant(s) === null)
        .sort(
          (a, b) =>
            (a.lastDetachedAt ?? a.createdAt) -
            (b.lastDetachedAt ?? b.createdAt),
        );
      if (detached.length > 0) {
        this.destroySession(detached[0].id);
      }
    }

    if (tabInstanceId) {
      const tabSessions = userSessions.filter(
        (s) => s.tabInstanceId === tabInstanceId,
      );
      for (const existing of tabSessions) {
        const isLiveSession =
          existing.isConnected &&
          existing.sshStream != null &&
          !existing.sshStream.destroyed;
        if (isLiveSession) {
          // Don't destroy a live session (even if detached) — the caller should attach instead
          sshLogger.warn(
            "Tab instance has live session, skipping duplicate create",
            {
              operation: "session_tab_duplicate_skip",
              existingSessionId: existing.id,
              tabInstanceId,
              hasAttachedWs: this.getOwnerParticipant(existing) !== null,
            },
          );
          return existing.id;
        }
        sshLogger.warn("Tab instance already has session, destroying old", {
          operation: "session_tab_duplicate_cleanup",
          existingSessionId: existing.id,
          tabInstanceId,
        });
        this.destroySession(existing.id);
      }
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    let recordingPath: string | null = null;
    let recordingHeader: string | null = null;
    if (sessionLoggingEnabled) {
      const userLogDir = path.join(SESSION_LOGS_DIR, userId);
      recordingPath = path.join(userLogDir, `${id}.cast`);
      recordingHeader = `${JSON.stringify({
        version: 2,
        width: cols,
        height: rows,
        timestamp: Math.floor(now / 1000),
        env: { TERM: "xterm-256color", SHELL: "/bin/sh" },
      })}\n`;
    }
    const session: TerminalSession = {
      id,
      control: new SessionControl(
        id,
        {
          isReady: () => {
            const current = this.sessions.get(id);
            return (
              !!current?.isConnected &&
              !!current.sshStream &&
              !current.sshStream.destroyed
            );
          },
          write: (data) => {
            const current = this.sessions.get(id);
            if (!current?.sshStream)
              throw new ControlError("TRANSPORT_UNAVAILABLE");
            const input = Buffer.from(data);
            const before = current.control.snapshot();
            this.bufferInput(id, input.toString("utf8"));
            const after = current.control.snapshot();
            if (
              before.controller.kind === "automation" &&
              (after.controlEpoch !== before.controlEpoch ||
                after.generation !== before.generation ||
                after.closed)
            )
              throw new ControlError("STALE_CONTROL");
            current.sshStream.write(input);
          },
        },
        (event) => this.broadcast(id, event),
      ),
      userId,
      hostId,
      hostName,
      tabInstanceId,
      sshConn: null,
      sshStream: null,
      jumpClient: null,
      cols,
      rows,
      isConnected: false,
      createdAt: now,
      participants: new Map(),
      lastDetachedAt: null,
      detachTimeout: null,
      outputBuffer: [],
      outputBufferBytes: 0,
      outputSequence: 0,
      outputTruncated: false,
      outputGap: false,
      recordingPath,
      recordingHeader,
      recordingBytes: 0,
      recordingId: null,
      recordingWriter: null,
      recordingFailure: null,
      recordingEndedAt: null,
      recordingPersistChain: Promise.resolve(),
      recordingPersistRunning: false,
      recordingPersistRequested: false,
      lastPersistedFailure: null,
      tmuxSessionName: null,
      sessionLoggingEnabled,
      sessionStartedAt: now,
      lastPersistedBytes: 0,
      terminatedByOwner: false,
      terminationReason: null,
    };
    if (recordingPath) {
      const targetPath = recordingPath;
      session.recordingWriter = new RecordingWriter({
        write: async (chunk, first) => {
          if (first) {
            await fs.promises.mkdir(path.dirname(targetPath), {
              recursive: true,
            });
            await fs.promises.writeFile(
              targetPath,
              session.recordingHeader + chunk,
              { encoding: "utf8", flag: "wx" },
            );
          } else {
            await fs.promises.appendFile(targetPath, chunk, "utf8");
          }
        },
        committed: (bytes) => {
          session.recordingBytes += bytes;
          if (session.recordingFailure) this.maybePersistLog(session, true);
        },
        failed: (reason) => {
          session.recordingFailure = reason;
          session.recordingEndedAt ??= Date.now();
          if (!session.control.snapshot().closed) session.control.takeover();
          this.broadcast(session.id, {
            type: "context.gap",
            reason: "recording-stopped",
            recordingFailure: reason,
            sessionId: session.id,
          });
          this.maybePersistLog(session, true);
        },
      });
    }
    this.sessions.set(id, session);

    sshLogger.info("Terminal session created", {
      operation: "session_created",
      sessionId: id,
      userId,
      hostId,
    });

    return id;
  }

  getSession(sessionId: string | null): TerminalSession | null {
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  sendHumanInput(sessionId: string, ws: WebSocket, data: string): void {
    const session = this.sessions.get(sessionId);
    const participant = session ? this.getParticipantForWs(session, ws) : null;
    if (
      !session ||
      !participant ||
      participant.permissionLevel !== "read-write"
    ) {
      throw new ControlError("CONTROL_BUSY");
    }
    session.control.humanInput(Buffer.from(data, "utf8"));
  }

  sendTerminalReply(sessionId: string, ws: WebSocket, data: string): boolean {
    const session = this.sessions.get(sessionId),
      participant = session ? this.getParticipantForWs(session, ws) : null;
    if (
      !session?.isConnected ||
      !participant ||
      participant.permissionLevel !== "read-write"
    )
      return false;
    const owner = this.getOwnerParticipant(session);
    if (owner?.ws.readyState === WebSocket.OPEN && owner.ws !== ws)
      return false;
    return session.control.terminalReply(Buffer.from(data, "utf8"));
  }

  setSSHState(
    sessionId: string,
    conn: Client,
    stream: ClientChannel,
    jumpClient?: Client | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.sshConn = conn;
    session.sshStream = stream;
    session.jumpClient = jumpClient ?? null;
    session.isConnected = true;
    session.control.connectionChanged();
  }

  /** Finds the owner's participant entry, if currently attached. */
  private getOwnerParticipant(
    session: TerminalSession,
  ): SessionParticipant | null {
    for (const participant of session.participants.values()) {
      if (participant.isOwner) return participant;
    }
    return null;
  }

  private getOwnerEntry(
    session: TerminalSession,
  ): [string, SessionParticipant] | null {
    for (const entry of session.participants.entries()) {
      if (entry[1].isOwner) return entry;
    }
    return null;
  }

  attachWs(
    sessionId: string,
    userId: string,
    ws: WebSocket,
    tabInstanceId?: string,
  ): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sshLogger.warn("Session not found for attachment", {
        operation: "session_attach_not_found",
        sessionId,
        userId,
      });
      return null;
    }
    if (session.userId !== userId) {
      sshLogger.warn("Session userId mismatch", {
        operation: "session_attach_user_mismatch",
        sessionId,
        expectedUserId: session.userId,
        providedUserId: userId,
      });
      return null;
    }
    if (!session.isConnected) {
      sshLogger.warn("Session not connected", {
        operation: "session_attach_not_connected",
        sessionId,
        userId,
        createdAt: session.createdAt,
        elapsed: Date.now() - session.createdAt,
      });
      return null;
    }

    const ownerParticipant = this.getOwnerParticipant(session);
    const isDetached =
      !ownerParticipant || ownerParticipant.ws.readyState !== WebSocket.OPEN;
    const isOriginalTab =
      (session.attachedTabInstanceId ?? session.tabInstanceId) ===
      tabInstanceId;

    if (
      !isDetached &&
      !isOriginalTab &&
      session.tabInstanceId &&
      tabInstanceId
    ) {
      sshLogger.warn("Session actively attached to different tab instance", {
        operation: "session_attach_instance_conflict",
        sessionId,
        sessionInstanceId: session.tabInstanceId,
        providedInstanceId: tabInstanceId,
      });
      try {
        ws.send(
          JSON.stringify({
            type: "sessionExpired",
            sessionId,
            message: "Session belongs to a different tab instance",
          }),
        );
      } catch {
        /* ignore */
      }
      return null;
    }

    if (
      session.tabInstanceId &&
      tabInstanceId &&
      session.tabInstanceId !== tabInstanceId
    ) {
      sshLogger.info(
        "Session attached to different tab instance (split-screen)",
        {
          operation: "session_attach_split_screen",
          originalInstanceId: session.tabInstanceId,
          newInstanceId: tabInstanceId,
          sessionId,
        },
      );
    }

    const ownerEntry = this.getOwnerEntry(session);
    if (ownerEntry && ownerEntry[1].ws !== ws) {
      try {
        ownerEntry[1].ws.send(
          JSON.stringify({
            type: "sessionTakenOver",
            sessionId,
            message: "Session was attached from another tab",
          }),
        );
      } catch {
        /* ignore */
      }
      session.participants.delete(ownerEntry[0]);
    }

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    const participantId = crypto.randomUUID();
    session.participants.set(participantId, {
      ws,
      userId,
      permissionLevel: "read-write",
      isOwner: true,
      tabInstanceId,
    });
    session.attachedTabInstanceId = tabInstanceId;
    session.lastDetachedAt = null;

    sshLogger.info("WebSocket attached to session", {
      operation: "session_attach",
      sessionId,
      userId,
      tabInstanceId,
    });

    return session;
  }

  /**
   * Adds a non-owner participant (in-app share join or anonymous link guest).
   * Purely additive - never evicts the owner or any other participant.
   */
  joinAsParticipant(
    sessionId: string,
    ws: WebSocket,
    opts: {
      userId: string | null;
      permissionLevel: "read-write" | "read-only";
      guestLabel?: string;
      tabInstanceId?: string;
      shareId?: string;
    },
  ): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isConnected) return null;

    const participantId = crypto.randomUUID();
    session.participants.set(participantId, {
      ws,
      userId: opts.userId,
      permissionLevel: opts.permissionLevel,
      isOwner: false,
      guestLabel: opts.guestLabel,
      tabInstanceId: opts.tabInstanceId,
      joinedViaShareId: opts.shareId,
    });

    sshLogger.info("Participant joined shared session", {
      operation: "session_join_participant",
      sessionId,
      userId: opts.userId,
      permissionLevel: opts.permissionLevel,
      shareId: opts.shareId,
    });

    return session;
  }

  configureOutput(ws: WebSocket, acknowledgements: boolean): void {
    terminalOutputDelivery.configure(ws, acknowledgements);
  }

  acknowledgeOutput(ws: WebSocket, deliveryId: unknown): boolean {
    return terminalOutputDelivery.acknowledge(ws, deliveryId);
  }

  private sendToParticipant(
    session: TerminalSession,
    ws: WebSocket,
    message: object,
  ): void {
    terminalOutputDelivery.send(ws, message, () => {
      const participant = this.getParticipantForWs(session, ws);
      if (!participant?.isOwner) return;
      session.outputGap = true;
      if (!session.control.snapshot().closed) session.control.takeover();
      this.broadcast(session.id, {
        type: "context.gap",
        reason: "output-backpressure",
        sessionId: session.id,
      });
    });
  }

  /** A slow guest must not stall or revoke the owner's active session. */
  broadcast(sessionId: string, message: object): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const participant of session.participants.values())
      this.sendToParticipant(session, participant.ws, message);
  }

  replayOutput(session: TerminalSession, ws: WebSocket): void {
    if (
      session.outputTruncated ||
      session.outputGap ||
      session.recordingFailure
    )
      this.sendToParticipant(session, ws, {
        type: "context.gap",
        reason: session.outputGap
          ? "output-backpressure"
          : session.recordingFailure
            ? "recording-stopped"
            : "history-truncated",
        recordingFailure: session.recordingFailure,
        sessionId: session.id,
      });
    const text = this.getBuffer(session);
    if (text)
      this.sendToParticipant(session, ws, {
        type: "data",
        data: text,
        replay: true,
        terminalReplies: true,
      });
  }

  getOutputSnapshot(session: TerminalSession) {
    return {
      text: this.getBuffer(session) ?? "",
      cursor: session.outputSequence,
      firstCursor: session.outputSequence - session.outputBuffer.length,
      generation: session.control.snapshot().generation,
      truncated: session.outputTruncated || session.outputGap,
      recordingFailure: session.recordingFailure,
    };
  }

  /** Finds the participant entry (owner or not) for a given socket. */
  getParticipantForWs(
    session: TerminalSession,
    ws: WebSocket,
  ): SessionParticipant | null {
    for (const participant of session.participants.values()) {
      if (participant.ws === ws) return participant;
    }
    return null;
  }

  /**
   * Removes a non-owner participant's socket. No detach timeout or session
   * destruction side effects - a guest leaving must never end the session.
   */
  removeParticipant(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const [id, participant] of session.participants.entries()) {
      if (participant.ws === ws && !participant.isOwner) {
        session.participants.delete(id);
        sshLogger.info("Participant left shared session", {
          operation: "session_leave_participant",
          sessionId,
          userId: participant.userId,
        });
        return;
      }
    }
  }

  /** Broadcasts termination to all guests, then destroys the session. */
  ownerEndSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.broadcast(sessionId, { type: "sessionTerminatedByOwner", reason });
    session.terminatedByOwner = true;
    session.terminationReason = reason;

    sshLogger.info("Owner ended shared session", {
      operation: "session_owner_end",
      sessionId,
      reason,
    });

    this.destroySession(sessionId);
  }

  detachWs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    const ownerEntry = this.getOwnerEntry(session);
    if (ownerEntry) {
      session.participants.delete(ownerEntry[0]);
    }
    session.lastDetachedAt = Date.now();

    // Persist log immediately when the user detaches so it appears right away,
    // regardless of whether the session is later reattached or times out.
    this.maybePersistLog(session);

    const timeoutMs = this.getTimeoutMs();

    session.detachTimeout = setTimeout(() => {
      sshLogger.info("Session idle timeout expired", {
        operation: "session_idle_timeout",
        sessionId,
        userId: session.userId,
      });
      this.destroySession(sessionId);
    }, timeoutMs);

    sshLogger.info("WebSocket detached from session", {
      operation: "session_detach",
      sessionId,
      userId: session.userId,
      timeoutMinutes: timeoutMs / 60_000,
    });
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.control.close();

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    session.recordingEndedAt ??= Date.now();
    void session.recordingWriter?.close();
    this.maybePersistLog(session, true);

    for (const participant of session.participants.values()) {
      if (participant.isOwner) continue;
      if (participant.ws.readyState !== WebSocket.OPEN) continue;
      try {
        participant.ws.send(
          JSON.stringify({
            type: "sessionExpired",
            sessionId,
            message: "Session has ended",
          }),
        );
      } catch {
        /* ignore */
      }
    }
    session.participants.clear();

    if (session.sshStream) {
      try {
        session.sshStream.end();
      } catch {
        /* ignore */
      }
      session.sshStream = null;
    }

    if (session.sshConn) {
      try {
        session.sshConn.end();
      } catch {
        /* ignore */
      }
      session.sshConn = null;
    }

    if (session.jumpClient) {
      try {
        session.jumpClient.end();
      } catch {
        /* ignore */
      }
      session.jumpClient = null;
    }

    session.isConnected = false;
    session.outputBuffer = [];
    session.outputBufferBytes = 0;

    this.sessions.delete(sessionId);

    sshLogger.info("Terminal session destroyed", {
      operation: "session_destroyed",
      sessionId,
      userId: session.userId,
      hostId: session.hostId,
    });
  }

  private maybePersistLog(session: TerminalSession, force = false): void {
    const writer = session.recordingWriter;
    if (!writer || (!writer.acceptedBytes && !session.recordingFailure)) return;
    if (
      !force &&
      session.recordingBytes === session.lastPersistedBytes &&
      writer.acceptedBytes === session.recordingBytes &&
      session.recordingFailure === session.lastPersistedFailure
    )
      return;
    session.recordingPersistRequested = true;
    if (session.recordingPersistRunning) return;
    session.recordingPersistRunning = true;
    session.recordingPersistChain = Promise.resolve()
      .then(async () => {
        while (session.recordingPersistRequested) {
          session.recordingPersistRequested = false;
          await writer.flush();
          await this.persistSessionLog(session);
        }
      })
      .catch((error) => {
        sshLogger.warn("Failed to persist session log", {
          operation: "session_log_persist_error",
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        session.recordingPersistRunning = false;
        if (session.recordingPersistRequested)
          this.maybePersistLog(session, true);
      });
  }

  private async persistSessionLog(session: TerminalSession): Promise<void> {
    if (!session.recordingPath) return;
    const bytes = session.recordingBytes;
    const failure = session.recordingFailure;
    const endedAt = session.recordingEndedAt ?? Date.now();
    const duration = Math.floor((endedAt - session.sessionStartedAt) / 1000);
    const outcome = {
      endedAt: new Date(endedAt).toISOString(),
      duration,
      terminatedByOwner: failure
        ? false
        : session.terminatedByOwner || undefined,
      terminationReason: failure
        ? recordingFailureReason(failure)
        : (session.terminationReason ?? undefined),
    };
    const repo = createCurrentSessionRecordingRepository();
    if (session.recordingId == null) {
      const created = await repo.create({
        hostId: session.hostId,
        userId: session.userId,
        startedAt: new Date(session.sessionStartedAt).toISOString(),
        recordingPath: session.recordingPath,
        protocol: "ssh",
        format: "asciicast",
        ...outcome,
      });
      session.recordingId = created.id;
    } else {
      await repo.updateEnded(session.recordingId, outcome);
    }
    session.lastPersistedBytes = bytes;
    session.lastPersistedFailure = failure;
    sshLogger.info("Session log metadata persisted", {
      operation: "session_log_persisted",
      sessionId: session.id,
      userId: session.userId,
      hostId: session.hostId,
      duration,
      bytes: session.recordingBytes,
      recordingFailure: session.recordingFailure,
    });
  }

  getUserSessions(userId: string): TerminalSession[] {
    const result: TerminalSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        result.push(session);
      }
    }
    return result;
  }

  bufferOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.control.observeTerminalOutput(data);
    session.outputSequence++;
    session.outputBuffer.push(data);
    session.outputBufferBytes += Buffer.byteLength(data, "utf8");

    while (
      (session.outputBufferBytes > MAX_BUFFER_BYTES ||
        session.outputBuffer.length > 4096) &&
      session.outputBuffer.length > 0
    ) {
      const removed = session.outputBuffer.shift();
      if (removed)
        session.outputBufferBytes -= Buffer.byteLength(removed, "utf8");
      session.outputTruncated = true;
    }

    this.recordSessionEvent(session, "o", data);
  }

  bufferInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.recordSessionEvent(session, "i", data);
  }

  bufferResize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.recordSessionEvent(session, "r", `${cols}x${rows}`);
  }

  private recordSessionEvent(
    session: TerminalSession,
    type: "i" | "o" | "r",
    data: string,
  ): void {
    if (!session.recordingWriter || !data) return;
    const elapsed = (Date.now() - session.sessionStartedAt) / 1000;
    session.recordingWriter.append(
      `${JSON.stringify([elapsed, type, data])}\n`,
    );
  }

  flushBuffer(session: TerminalSession): string | null {
    if (session.outputBuffer.length === 0) return null;
    const data = session.outputBuffer.join("");
    session.outputTruncated = true;
    session.outputBuffer = [];
    session.outputBufferBytes = 0;
    return data;
  }

  getBuffer(session: TerminalSession): string | null {
    if (session.outputBuffer.length === 0) return null;
    return session.outputBuffer.join("");
  }

  private getTimeoutMs(): number {
    try {
      const value = getCurrentSettingValue("terminal_session_timeout_minutes");
      if (value) {
        const minutes = parseInt(value, 10);
        if (!isNaN(minutes) && minutes > 0) {
          return minutes * 60_000;
        }
      }
    } catch {
      // DB not available, use default
    }
    return DEFAULT_TIMEOUT_MINUTES * 60_000;
  }

  private healthCheck(): void {
    const toDestroy: string[] = [];
    const now = Date.now();
    const GRACE_PERIOD_MS = 10_000;

    for (const [id, session] of this.sessions) {
      if (!session.isConnected) continue;

      const hasOpenParticipant = Array.from(session.participants.values()).some(
        (p) => p.ws.readyState === WebSocket.OPEN,
      );
      if (hasOpenParticipant) {
        continue;
      }

      if (session.sshStream?.destroyed) {
        const detachedDuration = session.lastDetachedAt
          ? now - session.lastDetachedAt
          : 0;

        if (detachedDuration > GRACE_PERIOD_MS) {
          sshLogger.info(
            "SSH stream destroyed during detach window, cleaning up",
            {
              operation: "session_health_check_stream_destroyed",
              sessionId: id,
              userId: session.userId,
              detachedFor: detachedDuration,
            },
          );
          toDestroy.push(id);
        }
      }

      if (!session.sshConn) {
        toDestroy.push(id);
      }
    }

    for (const id of toDestroy) {
      this.destroySession(id);
    }
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroySession(id);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

export const sessionManager = TerminalSessionManager.getInstance();
