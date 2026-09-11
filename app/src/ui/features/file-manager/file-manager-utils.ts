export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formattedSize} ${units[unitIndex]}`;
}

/** File-manager display only. Remote modifiedTimestamp values are Unix seconds. */
export function createFileModifiedFormatter(locale: string) {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, options);
  } catch {
    formatter = new Intl.DateTimeFormat("zh-CN", options);
  }
  return (file: { modifiedTimestamp?: number; modified?: string }): string => {
    if (
      typeof file.modifiedTimestamp === "number" &&
      Number.isFinite(file.modifiedTimestamp)
    ) {
      const date = new Date(file.modifiedTimestamp * 1000);
      if (Number.isFinite(date.getTime())) return formatter.format(date);
    }
    return file.modified || "—";
  };
}
