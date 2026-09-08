import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { CommandAction } from "../../../types/collaboration-operations.js";
import type {
  CommandExecutorPort,
  PreparedCommand,
} from "../operations/gateway.js";

export interface TerminalOutputStream {
  destroyed?: boolean;
  on(event: "data", listener: (data: Uint8Array | string) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
  removeListener(
    event: "data",
    listener: (data: Uint8Array | string) => void,
  ): unknown;
  removeListener(event: "close" | "error", listener: () => void): unknown;
}
export interface PtyCommandResult {
  exitCode: number | null;
  output: string;
  cwd?: string;
  truncated: boolean;
  timedOut?: boolean;
  protocolError?: boolean;
}

export function quoteShellWord(value: string): string {
  // Interactive terminal input is not an execve argument vector: raw control
  // characters would be interpreted by line editing before shell quoting.
  // Refuse them rather than silently alter or execute a different argument.
  if (/[\x00-\x1f\x7f]/.test(value))
    throw new Error("UNSUPPORTED_TERMINAL_CONTROL_CHARACTER");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function frameCommand(
  action: CommandAction | null,
  token: string,
): Uint8Array {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error("INVALID_FRAME_TOKEN");
  const marker = `\\033]633;Tandem;${token};`;
  const resultVariable = `__tandem_${token}`;
  const variables: string[] = [];
  const preparation: string[] = [];
  const argv = action
    ? [
        quoteShellWord(action.program),
        ...action.args.map((arg, index) => {
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(arg))
            throw new Error("UNSUPPORTED_TERMINAL_CONTROL_CHARACTER");
          if (!/[\r\n\t]/.test(arg)) return quoteShellWord(arg);
          const variable = "__tandem_arg_" + token + "_" + index;
          variables.push(variable);
          preparation.push(
            variable +
              "=$(command printf '%s' " +
              quoteShellWord(Buffer.from(arg, "utf8").toString("base64")) +
              " | command base64 -d && command printf '.')",
          );
          return '"' + String.fromCharCode(36) + "{" + variable + '%.}"';
        }),
      ].join(" ")
    : "";
  const execution = action
    ? `if cd ${quoteShellWord(action.cwd)}; then if command ${argv}; then ${resultVariable}=0; else ${resultVariable}=$?; fi; else ${resultVariable}=$?; fi`
    : resultVariable + "=0";
  const command = preparation.length
    ? "if " +
      preparation.join(" && ") +
      "; then " +
      execution +
      "; else " +
      resultVariable +
      "=125; command printf '%s\\n' 'TandemSSH: argument decoding failed'; fi"
    : execution;
  // The command runs in the existing shell, so cd/export persist. Only the
  // read-only encoding of the physical working directory uses a command substitution. No eval or second
  // SSH exec channel is used. POSIX shell plus base64/tr is required.
  // A broken begin command must not fall through to the requested operation.
  const line =
    `if command printf '${marker}begin\\007'; then ` +
    [
      command,
      `command printf '${marker}end;%s;%s\\007' "$${resultVariable}" "$(command printf '%s' "$(command pwd -P)" | command base64 | command tr -d '\\r\\n')"`,
      `unset ${resultVariable} ${variables.join(" ")}`,
    ].join("; ") +
    "; fi\r";
  const bytes = Buffer.from(line, "utf8");
  if (bytes.byteLength > 64 * 1024) throw new Error("ACTION_TOO_LARGE");
  return bytes;
}

/** Bounded incremental decoder; packet boundaries may split UTF-8 and frames. */
export class CommandFrameDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private readonly begin: string;
  private readonly end: string;
  private pending = "";
  private phase: "waiting" | "output" | "metadata" | "done" = "waiting";
  private output = "";
  private truncated = false;
  private protocolError = false;
  private echoTail: string | undefined;

  constructor(
    token: string,
    private readonly finish: (result: PtyCommandResult) => void,
    private readonly maxOutput = 256_000,
    private readonly expectedEcho?: string,
  ) {
    this.begin = `\x1b]633;Tandem;${token};begin\x07`;
    this.end = `\x1b]633;Tandem;${token};end;`;
  }
  feed(data: Uint8Array | string): void {
    if (this.phase === "done") return;
    this.pending +=
      typeof data === "string" ? data : this.decoder.write(Buffer.from(data));
    if (this.phase === "waiting") {
      const index = this.pending.indexOf(this.begin);
      const prematureEnd = this.pending.indexOf(this.end);
      if (prematureEnd >= 0 && (index < 0 || prematureEnd < index)) {
        this.protocolError = true;
        this.unknown();
        return;
      }
      if (index < 0) {
        this.pending = this.pending.slice(
          -Math.max(
            this.begin.length - 1,
            (this.expectedEcho?.length ?? 0) + 512,
          ),
        );
        return;
      }
      // ConPTY may forward OSC frames before the last printable echo fragment.
      // Strip only an exact, proven remainder of the line we sent; on mismatch
      // preserve all data. No remote terminal mode or echo setting is changed.
      if (this.expectedEcho) {
        const visible = this.pending
          .slice(0, index)
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
        const anchor = this.expectedEcho.slice(
          0,
          Math.min(this.expectedEcho.length, 80),
        );
        const start = visible.lastIndexOf(anchor);
        if (start >= 0) {
          const echoed = visible.slice(start);
          if (this.expectedEcho.startsWith(echoed))
            this.echoTail = this.expectedEcho.slice(echoed.length);
        }
      }
      this.pending = this.pending.slice(index + this.begin.length);
      this.phase = "output";
    }
    if (this.phase === "output") {
      if (this.echoTail !== undefined) {
        const tail = this.echoTail;
        if (this.pending.length < tail.length) {
          if (tail.startsWith(this.pending)) return;
          this.echoTail = undefined;
        } else if (this.pending.startsWith(tail)) {
          const rest = this.pending.slice(tail.length);
          if (!rest.length || rest === "\r") return;
          if (rest.startsWith("\r\n")) this.pending = rest.slice(2);
          else if (rest.startsWith("\n")) this.pending = rest.slice(1);
          this.echoTail = undefined;
        } else this.echoTail = undefined;
      }
      const index = this.pending.indexOf(this.end);
      if (index < 0) {
        const keep = Math.min(this.pending.length, this.end.length - 1);
        this.append(this.pending.slice(0, this.pending.length - keep));
        this.pending = this.pending.slice(-keep);
        return;
      }
      this.append(this.pending.slice(0, index));
      this.pending = this.pending.slice(index + this.end.length);
      this.phase = "metadata";
    }
    if (this.phase === "metadata") {
      const end = this.pending.indexOf("\x07");
      if (end < 0) {
        if (this.pending.length > 16_384) this.unknown();
        return;
      }
      const fields = /^(\d{1,3});([A-Za-z0-9+/]*={0,2})$/.exec(
        this.pending.slice(0, end),
      );
      if (!fields || Number(fields[1]) > 255) {
        this.unknown();
        return;
      }
      const rawPath = Buffer.from(fields[2], "base64");
      let cwd: string;
      try {
        cwd = new TextDecoder("utf-8", { fatal: true }).decode(rawPath);
      } catch {
        this.unknown();
        return;
      }
      if (
        !cwd.startsWith("/") ||
        cwd.includes("\0") ||
        rawPath.toString("base64") !== fields[2]
      ) {
        this.unknown();
        return;
      }
      this.complete(Number(fields[1]), cwd);
    }
  }
  unknown(): void {
    if (this.phase === "done") return;
    if (this.phase === "output") this.append(this.pending);
    this.complete(null);
  }
  private append(text: string): void {
    const remaining = Math.max(0, this.maxOutput - this.output.length);
    this.output += text.slice(0, remaining);
    if (text.length > remaining) this.truncated = true;
  }
  private complete(exitCode: number | null, cwd?: string): void {
    this.phase = "done";
    this.pending = "";
    this.finish({
      exitCode,
      cwd,
      output: this.output,
      truncated: this.truncated,
      ...(this.protocolError ? { protocolError: true } : {}),
    });
  }
}

export class PtyCommandExecutor implements CommandExecutorPort {
  constructor(
    private readonly stream: () => TerminalOutputStream | null,
    private readonly timeoutMs = 60_000,
  ) {}
  prepare(
    action: CommandAction,
    _operationId: string,
  ): Promise<PreparedCommand> {
    return Promise.resolve(this.prepareFrame(action));
  }
  // For the session coordinator's audited context read on hand-back. This
  // only prepares a fixed read; the coordinator still owns authority/write.
  prepareContext(): PreparedCommand {
    return this.prepareFrame(null);
  }

  private prepareFrame(action: CommandAction | null): PreparedCommand {
    const stream = this.stream();
    if (!stream || stream.destroyed) throw new Error("TRANSPORT_UNAVAILABLE");
    const token = randomBytes(16).toString("hex");
    const bytes = frameCommand(action, token);
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve!: (result: PtyCommandResult) => void;
    const completion = new Promise<PtyCommandResult>((done) => {
      resolve = done;
    });
    const cleanup = () => {
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("close", onClose);
      stream.removeListener("error", onClose);
    };
    const decoder = new CommandFrameDecoder(
      token,
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ...result, timedOut });
      },
      256_000,
      Buffer.from(bytes).toString("utf8").replace(/\r$/, ""),
    );
    const onData = (data: Uint8Array | string) => decoder.feed(data);
    const onClose = () => decoder.unknown();
    stream.on("data", onData);
    stream.on("close", onClose);
    stream.on("error", onClose);
    return {
      bytes,
      completion,
      beforeSend: () => {
        if (settled || stream.destroyed)
          throw new Error("TRANSPORT_UNAVAILABLE");
        timer = setTimeout(
          () => {
            timedOut = true;
            decoder.unknown();
          },
          action
            ? (action.timeoutMs ?? this.timeoutMs)
            : Math.min(this.timeoutMs, 15_000),
        );
      },
      dispose: () => {
        cleanup();
        if (!settled) decoder.unknown();
      },
    };
  }
}
