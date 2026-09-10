import { WebSocket } from "ws";
interface DeliveryState {
  acknowledged: boolean;
  blocked: boolean;
  sequence: number;
  pending: Map<number, number>;
  pendingBytes: number;
}
/** One bounded delivery ledger per socket; it never retains output payloads. */
export class TerminalOutputDelivery {
  private readonly states = new WeakMap<WebSocket, DeliveryState>();
  constructor(
    private readonly maxBytes = 4 * 1024 * 1024,
    private readonly maxFrames = 1024,
  ) {}
  private state(ws: WebSocket) {
    let state = this.states.get(ws);
    if (!state) {
      state = {
        acknowledged: false,
        blocked: false,
        sequence: 0,
        pending: new Map(),
        pendingBytes: 0,
      };
      this.states.set(ws, state);
      const current = state;
      ws.once("close", () => {
        current.blocked = true;
        current.pending.clear();
        current.pendingBytes = 0;
      });
    }
    return state;
  }
  configure(ws: WebSocket, acknowledged: boolean) {
    this.state(ws).acknowledged = acknowledged;
  }
  acknowledge(ws: WebSocket, id: unknown): boolean {
    const state = this.states.get(ws);
    if (
      !state?.acknowledged ||
      state.blocked ||
      !Number.isSafeInteger(id) ||
      (id as number) < 1 ||
      (id as number) > state.sequence
    )
      return false;
    for (const [sequence, bytes] of state.pending) {
      if (sequence > (id as number)) break;
      state.pending.delete(sequence);
      state.pendingBytes -= bytes;
    }
    return true;
  }
  send(ws: WebSocket, message: object, onGap: () => void): boolean {
    const state = this.state(ws);
    if (state.blocked || ws.readyState !== WebSocket.OPEN) return false;
    const tracked =
      state.acknowledged && (message as { type?: string }).type === "data";
    const sequence = state.sequence + 1;
    const payload = JSON.stringify(
      tracked ? { ...message, deliveryId: sequence } : message,
    );
    const bytes = Buffer.byteLength(payload);
    const fail = () => {
      if (state.blocked) return;
      state.blocked = true;
      state.pending.clear();
      state.pendingBytes = 0;
      try {
        onGap();
      } catch {
        /* delivery failure cannot restore permission */
      }
      const timer = setTimeout(() => ws.terminate(), 1000);
      timer.unref?.();
      ws.once("close", () => clearTimeout(timer));
      try {
        ws.close(1013, "TERMINAL_OUTPUT_OVERFLOW");
      } catch {
        ws.terminate();
      }
    };
    if (
      ws.bufferedAmount + bytes > this.maxBytes ||
      (tracked &&
        (state.pendingBytes + bytes > this.maxBytes ||
          state.pending.size >= this.maxFrames))
    ) {
      fail();
      return false;
    }
    if (tracked) {
      state.sequence = sequence;
      state.pending.set(sequence, bytes);
      state.pendingBytes += bytes;
    }
    try {
      ws.send(payload, (error) => {
        if (error) fail();
      });
      return true;
    } catch {
      fail();
      return false;
    }
  }
}
export const terminalOutputDelivery = new TerminalOutputDelivery();
