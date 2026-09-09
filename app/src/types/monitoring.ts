export type MonitoringActionStatus =
  | "running"
  | "completed"
  | "unavailable"
  | "denied"
  | "cancelled"
  | "timeout"
  | "output-limit"
  | "failed";
export interface MonitoringCommandTemplate {
  id: string;
  widget: string;
  template: string;
  timeoutMs: number;
}
export interface MonitoringAction {
  commandId: string;
  command: string;
  startedAt: number;
  finishedAt?: number;
  status: MonitoringActionStatus;
  exitCode?: number | null;
  outputBytes: number;
}
export interface MonitoringBatch {
  id: string;
  hostId: number;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "partial" | "cancelled" | "failed";
  actions: MonitoringAction[];
  errorCode?: string;
}
export interface MonitoringSnapshot {
  hostId: number;
  paused: boolean;
  intervalSeconds: number;
  metricsEnabled: boolean;
  commands: MonitoringCommandTemplate[];
  current?: MonitoringBatch;
  recent: MonitoringBatch[];
}
