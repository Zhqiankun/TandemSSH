export type RecordingFailure = "capacity" | "write-failed" | "write-timeout";
export function recordingFailureReason(reason: RecordingFailure): string {
  return "recording-stopped:" + reason;
}
export function parseRecordingFailure(value: unknown): RecordingFailure | null {
  if (typeof value !== "string") return null;
  const match =
    /^recording-stopped:(capacity|write-failed|write-timeout)$/.exec(value);
  return match ? (match[1] as RecordingFailure) : null;
}
