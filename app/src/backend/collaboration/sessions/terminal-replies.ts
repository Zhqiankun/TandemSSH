import {
  matchesTerminalReply,
  terminalQueryKind,
  type TerminalReplyKind,
} from "../../../types/terminal-replies.js";
/** A bounded ledger of queries observed in real SSH output, never in client input. */
export class TerminalReplyRequests {
  private state: "ground" | "escape" | "csi" | "string" = "ground";
  private csi = "";
  private invalid = false;
  private stringBel = false;
  private pending: Array<{ kind: TerminalReplyKind; expires: number }> = [];
  constructor(private readonly now: () => number = Date.now) {}
  clear() {
    this.state = "ground";
    this.csi = "";
    this.invalid = false;
    this.pending = [];
  }
  private prune() {
    const now = this.now();
    this.pending = this.pending.filter((item) => item.expires > now);
  }
  observe(data: string) {
    if (this.state === "ground" && !/[\x1b\x90\x98\x9b\x9d-\x9f]/.test(data))
      return;
    for (const ch of data) {
      if (ch === "\x1b") {
        this.state = "escape";
        continue;
      }
      if (ch === "\x18" || ch === "\x1a") {
        this.state = "ground";
        continue;
      }
      if (ch === "\x9b") {
        this.state = "csi";
        this.csi = "";
        this.invalid = false;
        continue;
      }
      if (["\x90", "\x98", "\x9d", "\x9e", "\x9f"].includes(ch)) {
        this.state = "string";
        this.stringBel = ch === "\x9d";
        continue;
      }
      if (ch === "\x9c") {
        this.state = "ground";
        continue;
      }
      if (this.state === "string") {
        if (this.stringBel && ch === "\x07") this.state = "ground";
        continue;
      }
      if (this.state === "escape") {
        if (ch === "[") {
          this.state = "csi";
          this.csi = "";
          this.invalid = false;
        } else if (["]", "P", "X", "^", "_"].includes(ch)) {
          this.state = "string";
          this.stringBel = ch === "]";
        } else this.state = "ground";
        continue;
      }
      if (this.state !== "csi") continue;
      const code = ch.charCodeAt(0);
      if (code >= 0x40 && code <= 0x7e) {
        if (!this.invalid && /^[?>]?[0-9;:]*$/.test(this.csi)) {
          const prefix = /^[?>]/.test(this.csi) ? this.csi[0] : "",
            first = Number(
              this.csi.slice(prefix.length).split(/[;:]/)[0] || "0",
            ),
            kind = terminalQueryKind(prefix, ch, first);
          if (kind) {
            this.prune();
            if (this.pending.length < 64)
              this.pending.push({ kind, expires: this.now() + 10000 });
          }
        }
        this.state = "ground";
        this.csi = "";
        continue;
      }
      if (code >= 0x20) {
        if (this.csi.length < 32) this.csi += ch;
        else this.invalid = true;
      }
    }
  }
  consume(data: string): boolean {
    this.prune();
    const index = this.pending.findIndex((item) =>
      matchesTerminalReply(item.kind, data),
    );
    if (index < 0) return false;
    this.pending.splice(index, 1);
    return true;
  }
}
