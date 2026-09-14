import { aiSessionKeys } from "../database/repositories/ai-session-keys.js";
type Change = { enabled: boolean; userId?: string };
const listeners = new Set<(change: Change) => void>();
export function onAiAccessChanged(
  listener: (change: Change) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyAiAccessChanged(change: Change): void {
  if (!change.enabled) aiSessionKeys.clear(change.userId);
  for (const listener of listeners) listener(change);
}
