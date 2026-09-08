export type AutomationOwner = {
  kind: "automation";
  ownerType: "agent-task" | "workflow-run" | "mcp-client";
  ownerId: string;
};

export type SessionController = { kind: "human" } | AutomationOwner;

export interface ControlSnapshot {
  sessionId: string;
  generation: number;
  controlEpoch: number;
  controller: SessionController;
  closed: boolean;
}

export interface ControlLease {
  sessionId: string;
  generation: number;
  controlEpoch: number;
  ownerType: AutomationOwner["ownerType"];
  ownerId: string;
}

export type CollaborationErrorCode =
  | "SESSION_CLOSED"
  | "STALE_CONTROL"
  | "CONTROL_BUSY"
  | "INVALID_INPUT"
  | "TRANSPORT_UNAVAILABLE"
  | "RESULT_UNKNOWN";

export interface ControlChangedEvent {
  type: "collaboration.control.changed";
  reason: "takeover" | "grant" | "connection-changed" | "closed";
  state: ControlSnapshot;
}
