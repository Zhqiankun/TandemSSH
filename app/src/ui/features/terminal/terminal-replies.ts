import type { Terminal } from "@xterm/xterm";
import {
  matchesTerminalReply,
  terminalQueryKind,
  type TerminalReplyKind,
} from "@/types/terminal-replies";
/** xterm emits its built-in CSI replies synchronously after these public handlers return false. */
export function installTerminalReplies(terminal: Pick<Terminal, "parser">) {
  let serial = 0,
    replaying = 0,
    disposed = false,
    pending:
      { kind: TerminalReplyKind; replay: boolean; serial: number } | undefined;
  const handlers = [
    ["", "n"],
    ["?", "n"],
    ["", "c"],
    [">", "c"],
  ].map(([prefix, final]) =>
    terminal.parser.registerCsiHandler(
      { ...(prefix ? { prefix } : {}), final },
      (params) => {
        const value = params[0],
          first = Array.isArray(value) ? value[0] : (value ?? 0),
          kind = terminalQueryKind(prefix, final, first);
        if (kind) {
          const current = ++serial;
          pending = { kind, replay: replaying > 0, serial: current };
          queueMicrotask(() => {
            if (pending?.serial === current) pending = undefined;
          });
        }
        return false;
      },
    ),
  );
  return {
    consume(data: string): { replay: boolean } | undefined {
      if (disposed || !pending || !matchesTerminalReply(pending.kind, data))
        return;
      const result = { replay: pending.replay };
      pending = undefined;
      return result;
    },
    beginReplay(): () => void {
      replaying++;
      let ended = false;
      return () => {
        if (!ended) {
          ended = true;
          replaying--;
        }
      };
    },
    dispose() {
      disposed = true;
      pending = undefined;
      for (const handler of handlers) handler.dispose();
    },
  };
}
