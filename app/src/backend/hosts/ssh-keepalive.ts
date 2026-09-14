const MIN_KEEPALIVE_INTERVAL_MS = 5000;
// Node timers above this limit are reduced to 1 ms, not delayed further.
const MAX_TIMER_INTERVAL_MS = 2_147_483_647;

export function resolveSshKeepalive(
  intervalSeconds: number | undefined,
  countMax: number | undefined,
  defaultIntervalMs: number,
  defaultCountMax: number,
) {
  const milliseconds =
    typeof intervalSeconds === "number" ? intervalSeconds * 1000 : NaN;
  const validInterval =
    Number.isFinite(milliseconds) &&
    Math.abs(milliseconds) <= MAX_TIMER_INTERVAL_MS;
  const validCount =
    typeof countMax === "number" &&
    Number.isFinite(countMax) &&
    Number.isSafeInteger(Math.trunc(countMax));
  return {
    keepaliveInterval: !validInterval
      ? defaultIntervalMs
      : milliseconds === 0
        ? 0
        : Math.max(MIN_KEEPALIVE_INTERVAL_MS, Math.round(milliseconds)),
    keepaliveCountMax: !validCount
      ? defaultCountMax
      : countMax === 0
        ? 0
        : Math.max(1, Math.floor(countMax)),
  };
}
