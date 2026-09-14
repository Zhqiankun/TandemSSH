import { expect, it } from "vitest";
import { decodeDocument, encodeDocument } from "../../files/encoding.js";
import type {
  FileCharset,
  FileTextFormat,
} from "../../../types/file-document.js";

// Fixed wire bytes for 中文; expected bytes do not use the production codec.
const encodings: Array<{
  charset: FileCharset;
  text: string;
  bom: string;
  lf: string;
  cr: string;
}> = [
  { charset: "utf8", text: "e4b8ade69687", bom: "efbbbf", lf: "0a", cr: "0d" },
  { charset: "utf16le", text: "2d4e8765", bom: "fffe", lf: "0a00", cr: "0d00" },
  { charset: "utf16be", text: "4e2d6587", bom: "feff", lf: "000a", cr: "000d" },
  { charset: "gbk", text: "d6d0cec4", bom: "", lf: "0a", cr: "0d" },
  { charset: "gb18030", text: "d6d0cec4", bom: "", lf: "0a", cr: "0d" },
];
const cases = encodings.flatMap((e) =>
  (e.bom ? [false, true] : [false]).flatMap((bom) =>
    (["none", "lf", "crlf", "cr"] as const).map((lineEnding) => {
      const newline =
        lineEnding === "none"
          ? ""
          : lineEnding === "lf"
            ? e.lf
            : lineEnding === "cr"
              ? e.cr
              : e.cr + e.lf;
      return {
        label: e.charset + "/" + bom + "/" + lineEnding,
        format: { charset: e.charset, bom, lineEnding },
        bytes: Buffer.from((bom ? e.bom : "") + e.text + newline, "hex"),
        text:
          "中文" +
          (lineEnding === "none"
            ? ""
            : lineEnding === "lf"
              ? "\n"
              : lineEnding === "cr"
                ? "\r"
                : "\r\n"),
      };
    }),
  ),
);
it.each(cases)(
  "preserves fixed wire bytes $label",
  ({ format, bytes, text }) => {
    const decoded = decodeDocument(bytes, format.charset);
    expect(decoded).toEqual({ text, format });
    expect(
      encodeDocument(
        "中文" + (format.lineEnding === "none" ? "" : "\n"),
        format,
      ).bytes,
    ).toEqual(bytes);
    if (format.bom) expect(decodeDocument(bytes)).toEqual({ text, format });
  },
);
it.each([
  ["c328", undefined, "encoding-required"],
  ["fffe2d", undefined, "binary"],
  ["feff4e", undefined, "binary"],
  ["d6", "gbk", "binary"],
] as const)(
  "does not silently repair truncated or invalid bytes %s",
  (hex, charset, reason) => {
    expect(decodeDocument(Buffer.from(hex, "hex"), charset)).toEqual({
      reason,
    });
  },
);
it("preserves a literal BOM character after the file signature", () => {
  const bytes = Buffer.from("efbbbfefbbbfe4b8ade69687", "hex"),
    format: FileTextFormat = { charset: "utf8", bom: true, lineEnding: "none" };
  expect(decodeDocument(bytes)).toEqual({ text: "\uFEFF中文", format });
  expect(encodeDocument("\uFEFF中文", format).bytes).toEqual(bytes);
});
it("rejects an explicit charset conflicting with the file BOM", () => {
  expect(() =>
    decodeDocument(Buffer.from("fffe2d4e8765", "hex"), "utf8"),
  ).toThrow("FILE_BOM_MISMATCH");
});
