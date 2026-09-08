import iconv from "iconv-lite";
import type {
  FileCharset,
  FileLineEnding,
  FileTextFormat,
} from "../../types/file-document.js";
const BOM = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff]),
};
export const FILE_CHARSETS: FileCharset[] = [
  "utf8",
  "utf16le",
  "utf16be",
  "gbk",
  "gb18030",
];
function bomOf(data: Buffer): keyof typeof BOM | undefined {
  return (Object.keys(BOM) as Array<keyof typeof BOM>).find((key) =>
    data.subarray(0, BOM[key].length).equals(BOM[key]),
  );
}
export function lineEnding(text: string): FileLineEnding {
  const endings = new Set(
    (text.match(/\r\n|\r|\n/g) ?? []).map((value) =>
      value === "\r\n" ? "crlf" : value === "\r" ? "cr" : "lf",
    ),
  );
  return endings.size === 0
    ? "none"
    : endings.size === 1
      ? ([...endings][0] as FileLineEnding)
      : "mixed";
}
export function decodeDocument(
  bytes: Buffer,
  requested?: FileCharset,
): {
  text?: string;
  format?: FileTextFormat;
  reason?: "binary" | "encoding-required";
} {
  const detected = bomOf(bytes);
  if (requested && !FILE_CHARSETS.includes(requested))
    throw Error("FILE_ENCODING_UNSUPPORTED");
  if (detected && requested && requested !== detected)
    throw Error("FILE_BOM_MISMATCH");
  const charset = requested ?? detected ?? "utf8",
    data = detected ? bytes.subarray(BOM[detected].length) : bytes;
  let text: string;
  try {
    text = iconv.decode(data, charset, { stripBOM: false });
    if (!iconv.encode(text, charset, { addBOM: false }).equals(data))
      return { reason: requested || detected ? "binary" : "encoding-required" };
  } catch {
    return { reason: "encoding-required" };
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    return { reason: "binary" };
  return {
    text,
    format: { charset, bom: !!detected, lineEnding: lineEnding(text) },
  };
}
export function encodeDocument(
  text: string,
  format: FileTextFormat,
): { bytes: Buffer; text: string } {
  if (
    typeof text !== "string" ||
    text.includes("\0") ||
    !FILE_CHARSETS.includes(format.charset) ||
    !["lf", "crlf", "cr", "mixed", "none"].includes(format.lineEnding) ||
    typeof format.bom !== "boolean"
  )
    throw Error("FILE_FORMAT_INVALID");
  if (format.lineEnding === "mixed")
    throw Error("FILE_LINE_ENDING_CHOICE_REQUIRED");
  const newline =
    format.lineEnding === "crlf"
      ? "\r\n"
      : format.lineEnding === "cr"
        ? "\r"
        : "\n";
  const normalized = text.replace(/\r\n|\r|\n/g, newline);
  const encoded = iconv.encode(normalized, format.charset, { addBOM: false });
  if (iconv.decode(encoded, format.charset, { stripBOM: false }) !== normalized)
    throw Error("FILE_ENCODING_LOSSY");
  const bom = BOM[format.charset as keyof typeof BOM];
  if (format.bom && !bom) throw Error("FILE_BOM_UNSUPPORTED");
  return {
    bytes: format.bom ? Buffer.concat([bom, encoded]) : encoded,
    text: normalized,
  };
}
