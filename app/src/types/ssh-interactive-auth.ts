export interface SSHInteractivePrompt {
  index: number;
  prompt: string;
  echo: boolean;
}
export interface SSHInteractiveChallenge {
  id: string;
  name: string;
  instructions: string;
  prompts: SSHInteractivePrompt[];
  expiresAt: number;
}
export const SSH_AUTH_MAX_PROMPTS = 16;
export const SSH_AUTH_MAX_RESPONSE_BYTES = 16 * 1024;
export const SSH_AUTH_MAX_TOTAL_RESPONSE_BYTES = 64 * 1024;
export type SSHInteractiveErrorCode =
  | "SSH_AUTH_STALE_PROMPT"
  | "SSH_AUTH_INVALID_RESPONSE"
  | "SSH_AUTH_INVALID_CHALLENGE"
  | "SSH_AUTH_TIMEOUT"
  | "SSH_AUTH_LIMIT"
  | "SSH_AUTH_CANCELLED"
  | "SSH_AUTH_CONNECTION_LOST";
export function validInteractiveResponses(
  value: unknown,
  count: number,
): value is string[] {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    count > SSH_AUTH_MAX_PROMPTS
  )
    return false;
  let total = 0;
  for (const response of value) {
    if (
      typeof response !== "string" ||
      response.length > SSH_AUTH_MAX_RESPONSE_BYTES
    )
      return false;
    const bytes = new TextEncoder().encode(response).length;
    if (bytes > SSH_AUTH_MAX_RESPONSE_BYTES) return false;
    total += bytes;
  }
  return total <= SSH_AUTH_MAX_TOTAL_RESPONSE_BYTES;
}

export function isInteractiveChallenge(
  value: unknown,
): value is SSHInteractiveChallenge {
  if (!value || typeof value !== "object") return false;
  const v = value as SSHInteractiveChallenge;
  if (
    typeof v.id !== "string" ||
    !v.id ||
    v.id.length > 128 ||
    typeof v.name !== "string" ||
    typeof v.instructions !== "string" ||
    !Number.isFinite(v.expiresAt) ||
    !Array.isArray(v.prompts) ||
    !v.prompts.length ||
    v.prompts.length > SSH_AUTH_MAX_PROMPTS
  )
    return false;
  if (
    v.prompts.some(
      (p) =>
        !p ||
        !Number.isInteger(p.index) ||
        p.index < 0 ||
        p.index >= SSH_AUTH_MAX_PROMPTS ||
        typeof p.prompt !== "string" ||
        typeof p.echo !== "boolean",
    )
  )
    return false;
  if (new Set(v.prompts.map((p) => p.index)).size !== v.prompts.length)
    return false;
  if (
    v.name.length +
      v.instructions.length +
      v.prompts.reduce((n, p) => n + p.prompt.length, 0) >
    32768
  )
    return false;
  return (
    new TextEncoder().encode(
      v.name + v.instructions + v.prompts.map((p) => p.prompt).join(""),
    ).length <= 32768
  );
}

export interface SSHInteractiveTarget {
  connectionId: string;
  channel: "files" | "monitoring" | "jump";
  hostId?: number;
  hostname?: string;
  address: string;
  port: number;
  username: string;
}
export type SharedSSHInteractiveRequest = SSHInteractiveChallenge & {
  target: SSHInteractiveTarget;
  waiting?: boolean;
};
