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
  status?: string;
  operationId?: string;
  actionType?: string;
  program?: string;
  path?: string;
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
