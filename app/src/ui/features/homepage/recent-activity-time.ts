/** Presentation shared by the two recent-activity views; no data access or timers. */
export function formatRecentActivityTime(
  timestamp: string,
  language: string,
  justNow: string,
  now = Date.now(),
): string {
  const elapsed = now - Date.parse(timestamp);
  if (!Number.isFinite(elapsed)) return "—";
  if (elapsed < 60_000) return justNow;
  const minutes = Math.floor(elapsed / 60_000);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 1440
        ? [Math.floor(minutes / 60), "hour"]
        : [Math.floor(minutes / 1440), "day"];
  return new Intl.RelativeTimeFormat(language.replaceAll("_", "-"), {
    numeric: "always",
  }).format(-value, unit);
}
