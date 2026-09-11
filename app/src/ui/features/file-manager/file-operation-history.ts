export interface SuccessfulFileAction {
  originalPath: string;
  targetPath: string;
  targetName: string;
}
/** Undo receipts are recorded only after a specific operation is acknowledged.
 * Capture the actual destination (including any copy-generated name). */
export function fileActionReceipt(
  originalPath: string,
  directory: string,
  targetName: string,
): SuccessfulFileAction {
  return {
    originalPath,
    targetPath: directory.replace(/\/$/, "") + "/" + targetName,
    targetName,
  };
}

/** Replace only the action being undone; later actions and failed receipts survive. */
export function settleFileUndo<
  T extends { data: { copiedFiles?: SuccessfulFileAction[] } },
>(
  history: readonly T[],
  action: T,
  completed: ReadonlySet<SuccessfulFileAction>,
): T[] {
  return history.flatMap((entry) => {
    if (entry !== action) return [entry];
    const remaining = entry.data.copiedFiles?.filter(
      (file) => !completed.has(file),
    );
    return remaining?.length
      ? [{ ...entry, data: { ...entry.data, copiedFiles: remaining } }]
      : [];
  });
}
