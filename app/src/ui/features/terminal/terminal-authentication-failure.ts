/** Authentication classification for terminal error frames, before network retry heuristics. */
export function terminalAuthenticationFailure(
  code: unknown,
  message: string,
): "private-key" | "credentials" | undefined {
  if (code === "SSH_PRIVATE_KEY_INVALID") return "private-key";
  if (code === "SSH_AUTHENTICATION_FAILED") return "credentials";
  if (
    /ssh key format error|cannot parse privatekey|(?:encrypted|invalid|incorrect).*private[ -]?key|private[ -]?key.*(?:passphrase|invalid)|(?:incorrect|invalid|bad|missing).*passphrase/i.test(
      message,
    )
  )
    return "private-key";
  const text = message.toLowerCase();
  if (
    (text.includes("auth") && text.includes("failed")) ||
    text.includes("permission denied") ||
    (text.includes("invalid") &&
      (text.includes("password") || text.includes("key"))) ||
    text.includes("incorrect password")
  )
    return "credentials";
  return undefined;
}
