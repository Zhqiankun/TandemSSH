import iconv from "iconv-lite";
import { StringDecoder } from "node:string_decoder";

import type { TerminalEncoding } from "../../../types/terminal-encoding.js";
export {
  terminalEncoding,
  type TerminalEncoding,
} from "../../../types/terminal-encoding.js";

// Each SSH stream owns a decoder; carry partial characters across packets.
export function createTerminalDecoder(encoding: TerminalEncoding) {
  if (encoding === "utf-8") return new StringDecoder("utf8");
  const decoder = new TextDecoder(encoding, { ignoreBOM: true });
  return {
    write: (bytes: Uint8Array) => decoder.decode(bytes, { stream: true }),
    end: () => decoder.decode(),
  };
}

// Shared control input is UTF-8. Transcode only at the SSH transport boundary.
export function encodeTerminalInput(
  input: Uint8Array,
  encoding: TerminalEncoding,
): Buffer {
  const bytes = Buffer.from(input);
  if (encoding === "utf-8") return bytes;
  const text = bytes.toString("utf8");
  const encoded = iconv.encode(text, encoding);
  if (iconv.decode(encoded, encoding, { stripBOM: false }) !== text) {
    throw new Error("TERMINAL_INPUT_NOT_REPRESENTABLE");
  }
  return encoded;
}
