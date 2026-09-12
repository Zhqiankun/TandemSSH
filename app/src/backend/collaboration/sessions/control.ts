import { TerminalReplyRequests } from "./terminal-replies.js";
import type {
  AutomationOwner,
  CollaborationErrorCode,
  ControlChangedEvent,
  ControlLease,
  ControlSnapshot,
  SessionController,
} from "../../../types/collaboration.js";

export class ControlError extends Error {
  constructor(public readonly code: CollaborationErrorCode) {
    super(code);
    this.name = "ControlError";
  }
}

export interface SessionWritePort {
  isReady(): boolean;
  // Must synchronously hand bytes to the existing stream. No asynchronous
  // preparation, retries or second SSH connection is permitted in this port.
  write(data: Uint8Array): void;
}

/** One instance per live terminal. All write/lease transitions are synchronous
 * in the backend event loop; slow preparation belongs before commitWrite. */
export class SessionControl {
  private readonly terminalReplies = new TerminalReplyRequests();
  private generation = 1;
  private epoch = 0;
  private manualRevision = 0;
  private owner: SessionController = { kind: "human" };
  private closed = false;
  private readonly listeners = new Set<(event: ControlChangedEvent) => void>();

  constructor(
    private readonly sessionId: string,
    private readonly transport: SessionWritePort,
    private readonly publish: (event: ControlChangedEvent) => void,
  ) {}

  subscribe(listener: (event: ControlChangedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ControlSnapshot {
    return {
      sessionId: this.sessionId,
      generation: this.generation,
      controlEpoch: this.epoch,
      controller: { ...this.owner },
      closed: this.closed,
    };
  }

  private ensureOpen(): void {
    if (this.closed) throw new ControlError("SESSION_CLOSED");
  }

  private changed(reason: ControlChangedEvent["reason"]): ControlSnapshot {
    const state = this.snapshot();
    // The observer cannot mutate authoritative state; event delivery failure
    // cannot restore a revoked lease. Durable audit is the operation gateway's
    // responsibility before automated dispatch, not this UI notification.
    try {
      this.publish({ type: "collaboration.control.changed", reason, state });
    } catch {
      /* observer unavailable */
    }
    for (const listener of [...this.listeners]) {
      try {
        listener({
          type: "collaboration.control.changed",
          reason,
          state: this.snapshot(),
        });
      } catch {
        /* observer failure does not restore authority */
      }
    }
    return this.snapshot();
  }

  takeover(): ControlSnapshot {
    this.ensureOpen();
    this.terminalReplies.clear();
    this.epoch++;
    this.owner = { kind: "human" };
    return this.changed("takeover");
  }

  grant(
    owner: AutomationOwner,
    expected: Pick<ControlSnapshot, "generation" | "controlEpoch">,
  ): ControlLease {
    this.ensureOpen();
    if (
      expected.generation !== this.generation ||
      expected.controlEpoch !== this.epoch
    ) {
      throw new ControlError("STALE_CONTROL");
    }
    if (this.owner.kind !== "human") throw new ControlError("CONTROL_BUSY");
    if (
      !owner.ownerId ||
      !["agent-task", "workflow-run", "mcp-client"].includes(owner.ownerType)
    ) {
      throw new ControlError("INVALID_INPUT");
    }
    this.owner = {
      kind: "automation",
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    };
    this.epoch++;
    this.changed("grant");
    return {
      sessionId: this.sessionId,
      generation: this.generation,
      controlEpoch: this.epoch,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    };
  }

  assertLease(lease: ControlLease): void {
    this.ensureOpen();
    if (
      lease.sessionId !== this.sessionId ||
      lease.generation !== this.generation ||
      lease.controlEpoch !== this.epoch
    ) {
      throw new ControlError("STALE_CONTROL");
    }
    if (
      this.owner.kind !== "automation" ||
      this.owner.ownerType !== lease.ownerType ||
      this.owner.ownerId !== lease.ownerId
    ) {
      throw new ControlError("CONTROL_BUSY");
    }
  }

  /** Internal gateway entry. The gateway checks policy and current approval
   * immediately before this method; callers cannot expose it as raw AI input. */
  commitWrite(lease: ControlLease, data: Uint8Array): void {
    this.assertLease(lease);
    this.write(data);
  }

  /** Only authenticated manual-terminal adapters call this. Macros, snippets,
   * workflows and model tools must use the operation gateway instead. */
  humanInputRevision(): number {
    return this.manualRevision;
  }

  humanInput(data: Uint8Array): void {
    this.ensureOpen();
    this.validateInput(data);
    if (this.owner.kind !== "human") this.takeover();
    this.manualRevision++;
    this.write(data);
  }

  observeTerminalOutput(data: string): void {
    if (!this.closed) this.terminalReplies.observe(data);
  }

  terminalReply(data: Uint8Array): boolean {
    if (
      this.closed ||
      !(data instanceof Uint8Array) ||
      data.byteLength > 64 ||
      !this.terminalReplies.consume(Buffer.from(data).toString("utf8"))
    )
      return false;
    this.write(data);
    return true;
  }

  connectionChanged(): void {
    this.ensureOpen();
    this.terminalReplies.clear();
    this.generation++;
    this.epoch++;
    this.owner = { kind: "human" };
    this.changed("connection-changed");
  }

  close(): void {
    if (this.closed) return;
    this.terminalReplies.clear();
    this.closed = true;
    this.epoch++;
    this.owner = { kind: "human" };
    this.changed("closed");
  }

  private validateInput(data: Uint8Array): void {
    if (
      !(data instanceof Uint8Array) ||
      data.byteLength === 0 ||
      data.byteLength > 64 * 1024
    ) {
      throw new ControlError("INVALID_INPUT");
    }
  }

  private write(data: Uint8Array): void {
    this.validateInput(data);
    if (!this.transport.isReady())
      throw new ControlError("TRANSPORT_UNAVAILABLE");
    try {
      this.transport.write(data);
    } catch {
      // A throw does not prove zero bytes reached the peer. Never retry this
      // write in a fallback encoding or report an unambiguous failure.
      this.takeover();
      throw new ControlError("RESULT_UNKNOWN");
    }
  }
}
