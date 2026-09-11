/** Sequential file actions stop on the first unconfirmed result. A rejected
 * request may have reached the remote host, so it is never labelled undone. */
export async function runFileBatch<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
): Promise<
  | { ok: true; completed: number }
  | { ok: false; completed: number; error: unknown }
> {
  let completed = 0;
  for (const item of items) {
    try {
      await action(item);
      completed++;
    } catch (error) {
      return { ok: false, completed, error };
    }
  }
  return { ok: true, completed };
}

export function assertFileSession(
  expected: string,
  current: string | null | undefined,
): void {
  if (!expected || expected !== current) throw Error("FILE_SESSION_CHANGED");
}
