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
  for (const listener of listeners) listener(change);
}
