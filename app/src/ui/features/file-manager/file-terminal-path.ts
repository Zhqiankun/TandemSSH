/** Parent for a file-menu terminal action. Backslashes are separators only for
 * Windows drive paths; in POSIX names they remain literal characters. */
export function terminalParentPath(value: string): string {
  const windows = /^\/?[A-Za-z]:[\\/]/.test(value);
  const normalized = windows ? value.replaceAll("\\", "/") : value;
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return ".";
  const parent = slash === 0 ? "/" : normalized.slice(0, slash);
  return /^\/?[A-Za-z]:$/.test(parent) ? parent + "/" : parent;
}
