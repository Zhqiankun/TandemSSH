// SSH terminal wire encodings; UI and transport share this configuration contract.
export const TERMINAL_ENCODINGS = [
  "utf-8",
  "gb18030",
  "big5",
  "shift_jis",
] as const;
export type TerminalEncoding = (typeof TERMINAL_ENCODINGS)[number];
export function terminalEncoding(value: unknown): TerminalEncoding {
  return TERMINAL_ENCODINGS.includes(value as TerminalEncoding)
    ? (value as TerminalEncoding)
    : "utf-8";
}
