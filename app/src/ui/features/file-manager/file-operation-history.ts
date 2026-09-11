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
