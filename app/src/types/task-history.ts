export interface AuditHistoryQuery {
  cursor?: string;
  taskId?: string;
  limit?: number;
}
export interface AuditHistoryItem {
  id: string;
  at: number;
  type: string;
  taskId?: string;
  title?: string;
  hostName?: string;
  hostId?: number;
  sessionId?: string;
  origin?:
    "human" | "agent" | "assistant" | "workflow" | "mcp" | "command-panel";
  mode?: "automatic" | "collaborative";
  policyRevision?: number;
  policyOutcome?: "allow" | "confirm" | "deny" | "unknown";
  cwd?: string;
  outputPreview?: string;
  outputTruncated?: boolean;
  exitCode?: number;
  status?: string;
  error?: string;
  operationId?: string;
  actionType?: string;
  program?: string;
  path?: string;
  fileBytes?: number;
  fileCommitMayHaveOccurred?: boolean;
  detail: string;
}
export interface AuditHistoryPage {
  items: AuditHistoryItem[];
  nextCursor: string | null;
  skipped: number;
  scannedBytes: number;
  retentionDays: number;
  maxBytes: number;
}
export interface AuditHistoryDetail {
  id: string;
  offset: number;
  text: string;
  total: number;
  nextOffset: number | null;
}

export const AUDIT_EXPORT_LIMITS = {
  bytes: 256 * 1024 * 1024,
  lineBytes: 4 * 1024 * 1024,
  records: 1_000_000,
  shards: 4096,
} as const;
export interface AuditExportQuery {
  taskId?: string;
}
/** skipped counts damaged lines or unavailable shards, not an exact missing-event count. */
export interface AuditExportSummary {
  kind: "summary";
  completed: true;
  records: number;
  skipped: number;
  scannedBytes: number;
}
export type AuditExportFrame =
  | {
      kind: "header";
      schemaVersion: 1;
      startedAt: number;
      taskId: string | null;
      retentionDays: number;
    }
  | { kind: "record"; record: unknown }
  | AuditExportSummary;
