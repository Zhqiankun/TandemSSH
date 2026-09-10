export type TerminalReplyKind =
  | "cursor"
  | "private-cursor"
  | "status"
  | "primary-attributes"
  | "secondary-attributes";
export function terminalQueryKind(
  prefix: string,
  final: string,
  first: number,
): TerminalReplyKind | undefined {
  if (final === "n") {
    if (prefix === "" && first === 6) return "cursor";
    if (prefix === "?" && first === 6) return "private-cursor";
    if (prefix === "" && first === 5) return "status";
  }
  if (final === "c" && first === 0) {
    if (prefix === "") return "primary-attributes";
    if (prefix === ">") return "secondary-attributes";
  }
}
export function matchesTerminalReply(
  kind: TerminalReplyKind,
  data: string,
): boolean {
  if (!data || data.length > 64) return false;
  if (kind === "status") return data === "\x1b[0n";
  if (kind === "cursor" || kind === "private-cursor") {
    const match = (
      kind === "cursor"
        ? /^\x1b\[([0-9]{1,5});([0-9]{1,5})R$/
        : /^\x1b\[\?([0-9]{1,5});([0-9]{1,5})R$/
    ).exec(data);
    return (
      !!match &&
      Number(match[1]) > 0 &&
      Number(match[1]) <= 65535 &&
      Number(match[2]) > 0 &&
      Number(match[2]) <= 65535
    );
  }
  return (
    kind === "primary-attributes"
      ? /^\x1b\[\?[0-9]{1,5}(;[0-9]{1,5}){0,15}c$/
      : /^\x1b\[>[0-9]{1,5}(;[0-9]{1,5}){0,15}c$/
  ).test(data);
}
