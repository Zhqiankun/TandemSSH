/** File-transfer presentation only; never changes queue state or byte counters. */
export function estimateTransfer(
  total: number | undefined,
  done: number,
  bytesPerSecond: number | undefined,
) {
  if (
    total === undefined ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(done) ||
    done < 0 ||
    done > total ||
    bytesPerSecond === undefined ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  )
    return undefined;
  const seconds = Math.ceil((total - done) / bytesPerSecond);
  if (!Number.isSafeInteger(seconds)) return undefined;
  return { speed: Number((bytesPerSecond / 1024).toPrecision(3)), seconds };
}
