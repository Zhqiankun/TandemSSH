import { expect, it } from "vitest";
import iconv from "iconv-lite";
import {
  createTerminalDecoder,
  encodeTerminalInput,
  terminalEncoding,
  type TerminalEncoding,
} from "../../../hosts/terminal/encoding";
it.each<[TerminalEncoding, string]>([
  ["utf-8", "中文😀"],
  ["gb18030", "中文😀"],
  ["big5", "繁體中文"],
  ["shift_jis", "日本語"],
])("preserves %s across every packet boundary", (encoding, text) => {
  const wire = iconv.encode(text, encoding);
  for (let split = 0; split <= wire.length; split++) {
    const decoder = createTerminalDecoder(encoding);
    expect(
      decoder.write(wire.subarray(0, split)) +
        decoder.write(wire.subarray(split)) +
        (decoder.end() ?? ""),
    ).toBe(text);
  }
  expect(encodeTerminalInput(Buffer.from(text), encoding)).toEqual(wire);
});
it("preserves control sequences and rejects lossy legacy input", () => {
  expect(encodeTerminalInput(Buffer.from("\x03\x1b[A"), "big5")).toEqual(
    Buffer.from("\x03\x1b[A"),
  );
  expect(() => encodeTerminalInput(Buffer.from("😀"), "big5")).toThrow(
    "TERMINAL_INPUT_NOT_REPRESENTABLE",
  );
  expect(terminalEncoding(undefined)).toBe("utf-8");
});
