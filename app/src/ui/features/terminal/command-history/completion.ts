/** History completion appends text; it never rewrites the existing line or sends controls. */
export function historyCompletion(
  input: string,
  candidate: string,
): { suffix: string; line: string } | null {
  const prefix = input.trimStart();
  if (
    !prefix ||
    historyHasControlCharacters(candidate) ||
    !candidate.startsWith(prefix) ||
    candidate.length <= prefix.length
  )
    return null;
  const suffix = candidate.slice(prefix.length);
  return { suffix, line: input + suffix };
}
export function historyHasControlCharacters(command: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(command);
}
