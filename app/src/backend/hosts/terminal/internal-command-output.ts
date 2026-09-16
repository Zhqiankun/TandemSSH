export interface InternalCommandFrame {
  token: string;
  expectedEcho: string;
  visibleCommand?: string;
}

type ActiveFrame = InternalCommandFrame & {
  phase: "waiting" | "output" | "metadata";
  pending: string;
};

const MAX_METADATA_CHARACTERS = 16_384;
const MAX_WAITING_OVERHEAD = 16_384;
const CLEAR_CURRENT_LINE = "\r\x1b[2K";

/**
 * Removes TandemSSH's private PTY framing protocol from the terminal stream.
 *
 * Automated commands must run in the existing interactive shell so changes to
 * cwd and shell state remain visible to the human. A PTY commonly echoes the
 * complete framing script before executing it. This filter is armed with the
 * random token immediately before that script is written, so it can replace
 * only that exact internal input with a short, human-readable command.
 */
export class InternalCommandOutputFilter {
  private active?: ActiveFrame;

  activeToken(): string | undefined {
    return this.active?.token;
  }

  recordingInput(): string | undefined {
    if (!this.active) return undefined;
    return this.active.visibleCommand
      ? this.active.visibleCommand + "\r"
      : "\r";
  }

  arm(frame: InternalCommandFrame): void {
    if (!/^[a-f0-9]{32}$/.test(frame.token))
      throw new Error("INVALID_FRAME_TOKEN");
    if (this.active) throw new Error("INTERNAL_COMMAND_OUTPUT_BUSY");
    this.active = { ...frame, phase: "waiting", pending: "" };
  }

  feed(data: string): string {
    if (!data) return "";
    const frame = this.active;
    if (!frame) return data;
    frame.pending += data;
    let visible = "";

    while (this.active === frame) {
      if (frame.phase === "waiting") {
        const begin = `\x1b]633;Tandem;${frame.token};begin\x07`;
        const beginAt = frame.pending.indexOf(begin);
        if (beginAt < 0) {
          if (
            frame.pending.length >
            frame.expectedEcho.length + begin.length + MAX_WAITING_OVERHEAD
          ) {
            visible += this.releaseWaiting(frame);
            this.active = undefined;
          }
          break;
        }

        const before = frame.pending.slice(0, beginAt);
        const echoAt = this.echoStart(before, frame.expectedEcho);
        visible += echoAt >= 0 ? before.slice(0, echoAt) : before;
        if (frame.visibleCommand) visible += `${frame.visibleCommand}\r\n`;
        else if (echoAt >= 0) visible += CLEAR_CURRENT_LINE;
        frame.pending = frame.pending.slice(beginAt + begin.length);
        frame.phase = "output";
        continue;
      }

      if (frame.phase === "output") {
        const end = `\x1b]633;Tandem;${frame.token};end;`;
        const endAt = frame.pending.indexOf(end);
        if (endAt < 0) {
          const safeLength = Math.max(0, frame.pending.length - end.length + 1);
          visible += frame.pending.slice(0, safeLength);
          frame.pending = frame.pending.slice(safeLength);
          break;
        }
        visible += frame.pending.slice(0, endAt);
        frame.pending = frame.pending.slice(endAt + end.length);
        frame.phase = "metadata";
        continue;
      }

      const metadataEnd = frame.pending.indexOf("\x07");
      if (metadataEnd < 0) {
        if (frame.pending.length > MAX_METADATA_CHARACTERS) {
          visible += frame.pending;
          this.active = undefined;
        }
        break;
      }
      visible += frame.pending.slice(metadataEnd + 1);
      this.active = undefined;
    }

    return visible;
  }

  release(token: string): string {
    const frame = this.active;
    if (!frame || frame.token !== token) return "";
    this.active = undefined;
    if (frame.phase === "metadata") return "";
    if (frame.phase === "output") return frame.pending;

    return this.releaseWaiting(frame);
  }

  private releaseWaiting(frame: ActiveFrame): string {
    const echoAt = this.echoStart(frame.pending, frame.expectedEcho);
    if (echoAt < 0) return frame.pending;
    let suffix = frame.pending.slice(echoAt + frame.expectedEcho.length);
    if (suffix.startsWith("\r\n")) suffix = suffix.slice(2);
    else if (suffix.startsWith("\n") || suffix.startsWith("\r"))
      suffix = suffix.slice(1);
    return (
      frame.pending.slice(0, echoAt) +
      (frame.visibleCommand
        ? `${frame.visibleCommand}\r\n`
        : CLEAR_CURRENT_LINE) +
      suffix
    );
  }

  private echoStart(value: string, expectedEcho: string): number {
    const exact = value.lastIndexOf(expectedEcho);
    if (exact >= 0) return exact;
    const anchor = expectedEcho.slice(0, Math.min(96, expectedEcho.length));
    return anchor ? value.lastIndexOf(anchor) : -1;
  }
}
