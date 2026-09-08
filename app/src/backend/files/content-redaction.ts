import { redact, redactString } from "../privacy/redaction.js";
function scrubString(value: string): string {
  return redactString(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/"'@]+@/gi, "$1[redacted]@")
    .replace(/\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/gi, "Basic [redacted]")
    .replace(
      /(^|\n)([\t ]*(?:export[\t ]+)?(?:pass|auth|authorization)\s*[:=]\s*)[^\r\n]*/gi,
      "$1$2[redacted]",
    );
}
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}
function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] === "{" || text[start] === "[") {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '"') i = stringEnd(text, i) - 1;
      else if (text[i] === "{" || text[i] === "[") depth++;
      else if (text[i] === "}" || text[i] === "]") {
        if (--depth === 0) return i + 1;
      }
    }
    return text.length;
  }
  let end = start;
  while (end < text.length && !/[\s,}\]]/.test(text[end])) end++;
  return end;
}
// Preserve JSON formatting so visible snippets can be matched exactly, including
// escaped keys. Secret containers are masked as a whole, not just string values.
export function scrubFileContent(content: string): string {
  try {
    JSON.parse(content);
    let result = "",
      last = 0;
    for (let i = 0; i < content.length; i++)
      if (content[i] === '"') {
        const end = stringEnd(content, i),
          value = JSON.parse(content.slice(i, end)) as string;
        let next = end;
        while (/\s/.test(content[next] ?? "") && next < content.length) next++;
        const probe = redact({ [value]: "__file_probe__" }) as Record<
          string,
          unknown
        >;
        if (
          content[next] === ":" &&
          (probe[value] !== "__file_probe__" ||
            /^(auth|credentials?)$/i.test(value))
        ) {
          let start = next + 1;
          while (/\s/.test(content[start] ?? "") && start < content.length)
            start++;
          const finish = valueEnd(content, start);
          if (content.slice(start, finish) !== "null") {
            result += content.slice(last, start) + '"[redacted]"';
            last = finish;
          }
          i = finish - 1;
        } else {
          const safe = scrubString(value);
          if (safe !== value) {
            result += content.slice(last, i) + JSON.stringify(safe);
            last = end;
          }
          i = end - 1;
        }
      }
    return result + content.slice(last);
  } catch {
    /* Non-JSON formats use the string redaction rules below. */
  }
  return scrubString(content).replace(
    /((?:"[\w.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|passphrase)[\w.-]*"|'[\w.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|passphrase)[\w.-]*')\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
    '$1"[redacted]"',
  );
}
