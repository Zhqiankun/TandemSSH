/** Sequential file actions stop on the first unconfirmed result. A rejected
 * request may have reached the remote host, so it is never labelled undone. */
export async function runFileBatch<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
  assertCurrent: () => void = () => {},
): Promise<
  | { ok: true; completed: number }
  | { ok: false; completed: number; error: unknown }
> {
  let completed = 0;
  for (const item of items) {
    try {
      assertCurrent();
      await action(item);
      completed++;
      assertCurrent();
    } catch (error) {
      return { ok: false, completed, error };
    }
  }
  return { ok: true, completed };
}

export function assertFileSession(
  expected: string,
  current: string | null | undefined,
  mounted = true,
): void {
  if (!mounted || !expected || expected !== current)
    throw Error("FILE_SESSION_CHANGED");
}
